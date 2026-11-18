import { Resend } from 'resend'

import { env, features } from './env'

/**
 * Resend 封裝。
 *
 * 未設定 API key 時不拋錯，而是回傳 skipped —— 讓系統在還沒接上
 * 寄信服務時仍能完整運作（到期掃描照跑、報價單照產生），
 * 只是不寄出。這樣才能分階段上線。
 */

export type MailResult =
  | { ok: true; id: string | null }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped?: false; error: string }

export type Attachment = {
  filename: string
  content: Buffer
}

let client: Resend | null = null

function resend(): Resend {
  if (!client) client = new Resend(env.RESEND_API_KEY)
  return client
}

export async function sendMail(options: {
  to: string[]
  subject: string
  html: string
  text?: string
  replyTo?: string
  attachments?: Attachment[]
}): Promise<MailResult> {
  if (!features.email) {
    return {
      ok: false,
      skipped: true,
      reason: '尚未設定 RESEND_API_KEY / MAIL_FROM',
    }
  }
  const recipients = options.to.filter(Boolean)
  if (recipients.length === 0) {
    return { ok: false, skipped: true, reason: '沒有有效的收件人' }
  }

  try {
    const { data, error } = await resend().emails.send({
      from: env.MAIL_FROM,
      to: recipients,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      attachments: options.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
      })),
    })

    if (error) return { ok: false, error: error.message }
    return { ok: true, id: data?.id ?? null }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** 系統通知一律寄給自己 */
export async function notifyOwner(options: {
  subject: string
  html: string
  text?: string
}): Promise<MailResult> {
  const to = env.NOTIFY_TO.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (to.length === 0) {
    return { ok: false, skipped: true, reason: '尚未設定 NOTIFY_TO' }
  }
  return sendMail({ ...options, to })
}

/* ------------------------------------------------------------------ */
/* HTML 樣板                                                            */
/* ------------------------------------------------------------------ */

/**
 * 信件用 inline style 而非 <style> 區塊：
 * Gmail 會剝除 <head> 裡的樣式，Outlook 更嚴格。
 */
export function emailLayout(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-Hant-TW">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,'Noto Sans TC','Microsoft JhengHei',sans-serif;color:#14181f;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dfe3e8;border-radius:12px;overflow:hidden;">
    <div style="padding:20px 24px;border-bottom:1px solid #dfe3e8;">
      <h1 style="margin:0;font-size:16px;font-weight:700;">${escapeHtml(title)}</h1>
    </div>
    <div style="padding:24px;font-size:14px;line-height:1.7;">
      ${body}
    </div>
  </div>
  <p style="max-width:640px;margin:16px auto 0;font-size:12px;color:#667085;text-align:center;">
    此信由冠澄數位行銷系統自動發送
  </p>
</body>
</html>`
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
