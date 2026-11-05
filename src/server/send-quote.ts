import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { quotes, services } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { formatTw } from '@/lib/dates'
import { env } from '@/lib/env'
import { emailLayout, escapeHtml, sendMail } from '@/lib/mailer'
import { formatMoney } from '@/lib/money'
import { renderQuotePdf } from '@/lib/pdf/render'
import { getSettings } from '@/lib/settings'
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
  | { ok: false; error: string }

export async function sendQuoteToClient(
  quoteId: string,
  actor: string,
): Promise<SendResult> {
  const quote = await db.query.quotes.findFirst({
    where: eq(quotes.id, quoteId),
    with: { client: true, site: true },
  })
  if (!quote) return { ok: false, error: '找不到這張報價單' }

  const recipients = await quoteRecipients(quote.clientId)
  if (recipients.length === 0) {
    return {
      ok: false,
      error: '這個客戶沒有設定報價單收件人，請先到客戶頁面補上聯絡人 Email',
    }
  }

  const settings = await getSettings()

  let pdf: { buffer: Buffer; filename: string }
  try {
    pdf = await renderQuotePdf(quoteId)
  } catch (error) {
    return {
      ok: false,
      error: `產生 PDF 失敗：${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const company = settings.companyName ?? ''
  const total = formatMoney(quote.total, quote.currency)

  const mail = await sendMail({
    to: recipients,
    replyTo: settings.companyEmail ?? undefined,
    subject: `${quote.client.name} ${quote.site.name} 續約報價單（${quote.quoteNo}）`,
    html: emailLayout(
      '續約報價單',
      `<p>${escapeHtml(quote.client.name)} 您好：</p>
<p>
  隨信附上「${escapeHtml(quote.site.name)}」的續約報價單，
  合計 <strong>${total}</strong>，報價有效期限至
  <strong>${formatTw(quote.validUntil)}</strong>。
</p>
<p>詳細項目與服務期間請見附件 PDF。如有任何問題，歡迎直接回覆本信。</p>
<p style="margin-top:24px;color:#667085;">${escapeHtml(company)}</p>`,
    ),
    text: `${quote.client.name} 您好：

隨信附上「${quote.site.name}」的續約報價單（${quote.quoteNo}），
合計 ${total}，報價有效期限至 ${formatTw(quote.validUntil)}。

詳細項目與服務期間請見附件 PDF。如有任何問題，歡迎直接回覆本信。

${company}`,
    attachments: [{ filename: pdf.filename, content: pdf.buffer }],
  })

  if (!mail.ok) {
    const reason =
      'skipped' in mail && mail.skipped ? mail.reason : 'error' in mail ? mail.error : '未知錯誤'
    await logActivity(actor, 'quote.send_failed', 'quote', quoteId, {
      quoteNo: quote.quoteNo,
      reason,
    })
    return { ok: false, error: `寄送失敗：${reason}` }
  }

  // 寄出成功才推進狀態，且把實際收件人留存以備查
  await db
    .update(quotes)
    .set({
      status: 'sent',
      sentAt: new Date(),
      sentTo: recipients,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
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
