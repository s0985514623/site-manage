import { and, eq, inArray, isNull } from 'drizzle-orm'

import { db } from '@/db'
import { quotes, services } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { formatTw } from '@/lib/dates'
import { env, features } from '@/lib/env'
import { emailLayout, escapeHtml, sendMail } from '@/lib/mailer'
import { formatMoney } from '@/lib/money'
import { renderQuotePdf } from '@/lib/pdf/render'
import { isRenewalQuote, quoteSubjectName } from '@/lib/quote-display'
import { getSettings } from '@/lib/settings'
import type { ViolationType } from './actions/helpers'
import { quoteRecipients } from './queries'

/**
 * 把報價單寄給客戶。
 *
 * 這是系統唯一會主動對外送出東西的動作，呼叫端必須已經通過
 * 完整的授權檢查（LINE 簽章 + userId 白名單 + 一次性 token，
 * 或後台的登入 session）。這個函式本身不做授權判斷。
 *
 * 信件內文刻意精簡，細節全部放 PDF —— 這是台灣報價單的慣例，
 * 客戶通常會把 PDF 直接轉給會計。
 */

export type SendResult =
  | { ok: true; recipients: string[]; quoteNo: string; total: string }
  | { ok: false; error: string; violationType: ViolationType }

const SENDABLE = ['draft', 'pending_approval'] as const

/**
 * 寄出流程：驗證 → 搶佔 → 產 PDF 寄信 → 推進服務項目狀態。
 *
 * 搶佔（R6）：先以條件式 UPDATE 把報價單改成 sent，影響 0 列代表另一個請求已經
 * 在寄了（連點兩下、後台與 LINE 同時按），這次直接回 QUOTE_ALREADY_SENT，
 * 不會寄出第二封。寄信失敗再把狀態還原，報價單維持原狀可以重寄。
 */
export async function sendQuoteToClient(
  quoteId: string,
  actor: string,
): Promise<SendResult> {
  const quote = await db.query.quotes.findFirst({
    where: eq(quotes.id, quoteId),
    with: { client: true, site: true, project: true },
  })
  if (!quote) return { ok: false, error: '找不到這張報價單', violationType: 'NOT_FOUND' }
  if (quote.status === 'sent' || quote.sentAt) {
    return { ok: false, error: '這張報價單已經寄出過了，沒有重複寄送。', violationType: 'QUOTE_ALREADY_SENT' }
  }
  if (!(SENDABLE as readonly string[]).includes(quote.status)) {
    return { ok: false, error: '這張報價單目前的狀態不能寄出。', violationType: 'INVALID_QUOTE_STATUS' }
  }

  const recipients = await quoteRecipients(quote.clientId)
  if (recipients.length === 0) {
    return {
      ok: false,
      error: '這個客戶沒有設定報價單收件人，請先到客戶頁面補上聯絡人 Email',
      violationType: 'NO_RECIPIENT',
    }
  }
  if (!features.email) {
    return { ok: false, error: '尚未設定寄信服務（Resend），無法寄出。', violationType: 'MAIL_NOT_CONFIGURED' }
  }

  // 搶佔：只有一個請求能把這張單從草稿 / 待確認改成已寄出
  const [claimed] = await db
    .update(quotes)
    .set({ status: 'sent', sentAt: new Date(), sentTo: recipients, updatedAt: new Date() })
    .where(
      and(eq(quotes.id, quoteId), inArray(quotes.status, [...SENDABLE]), isNull(quotes.sentAt)),
    )
    .returning({ id: quotes.id })
  if (!claimed) {
    return { ok: false, error: '這張報價單已經寄出過了，沒有重複寄送。', violationType: 'QUOTE_ALREADY_SENT' }
  }

  const release = () =>
    db
      .update(quotes)
      .set({ status: quote.status, sentAt: null, sentTo: null, updatedAt: new Date() })
      .where(eq(quotes.id, quoteId))

  const settings = await getSettings()

  let pdf: { buffer: Buffer; filename: string }
  try {
    pdf = await renderQuotePdf(quoteId)
  } catch (error) {
    await release()
    return {
      ok: false,
      error: `產生 PDF 失敗：${error instanceof Error ? error.message : String(error)}`,
      violationType: 'MAIL_SEND_FAILED',
    }
  }

  const company = settings.companyName ?? ''
  const total = formatMoney(quote.total, quote.currency)
  const subject = quoteSubjectName(quote)
  // 專案報價不是續約，信件不寫「續約」
  const kind = isRenewalQuote(quote) ? '續約報價單' : '報價單'

  const mail = await sendMail({
    to: recipients,
    replyTo: settings.companyEmail ?? undefined,
    subject: `${quote.client.name} ${subject} ${kind}（${quote.quoteNo}）`,
    html: emailLayout(
      kind,
      `<p>${escapeHtml(quote.client.name)} 您好：</p>
<p>
  隨信附上「${escapeHtml(subject)}」的${kind}，
  合計 <strong>${total}</strong>，報價有效期限至
  <strong>${formatTw(quote.validUntil)}</strong>。
</p>
<p>詳細項目與服務期間請見附件 PDF。如有任何問題，歡迎直接回覆本信。</p>
<p style="margin-top:24px;color:#667085;">${escapeHtml(company)}</p>`,
    ),
    text: `${quote.client.name} 您好：

隨信附上「${subject}」的${kind}（${quote.quoteNo}），
合計 ${total}，報價有效期限至 ${formatTw(quote.validUntil)}。

詳細項目與服務期間請見附件 PDF。如有任何問題，歡迎直接回覆本信。

${company}`,
    attachments: [{ filename: pdf.filename, content: pdf.buffer }],
  })

  if (!mail.ok) {
    const reason =
      'skipped' in mail && mail.skipped ? mail.reason : 'error' in mail ? mail.error : '未知錯誤'
    await release()
    await logActivity(actor, 'quote.send_failed', 'quote', quoteId, {
      quoteNo: quote.quoteNo,
      reason,
    })
    return { ok: false, error: `寄送失敗：${reason}`, violationType: 'MAIL_SEND_FAILED' }
  }

  // 寄出時間與收件人已在搶佔時寫入；這裡補上確認時間
  await db
    .update(quotes)
    .set({ approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(quotes.id, quoteId))

  await db
    .update(services)
    .set({ renewalState: 'sent', updatedAt: new Date() })
    .where(eq(services.currentQuoteId, quoteId))

  await logActivity(actor, 'quote.sent', 'quote', quoteId, {
    quoteNo: quote.quoteNo,
    client: quote.client.name,
    recipients,
    total: quote.total,
  })

  return {
    ok: true,
    recipients,
    quoteNo: quote.quoteNo,
    total,
  }
}

/** 你在 LINE 上按取消：作廢報價單並把項目釋放回待處理 */
export async function cancelQuote(
  quoteId: string,
  actor: string,
): Promise<{ ok: true; quoteNo: string } | { ok: false; error: string }> {
  const quote = await db.query.quotes.findFirst({
    where: eq(quotes.id, quoteId),
  })
  if (!quote) return { ok: false, error: '找不到這張報價單' }

  await db.transaction(async (tx) => {
    await tx
      .update(quotes)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(quotes.id, quoteId))

    // 釋放項目，讓下一個週期能重新擬草稿
    await tx
      .update(services)
      .set({
        currentQuoteId: null,
        renewalState: 'upcoming',
        updatedAt: new Date(),
      })
      .where(eq(services.currentQuoteId, quoteId))
  })

  await logActivity(actor, 'quote.cancelled', 'quote', quoteId, {
    quoteNo: quote.quoteNo,
  })

  return { ok: true, quoteNo: quote.quoteNo }
}

export const APP_URL = env.APP_URL
