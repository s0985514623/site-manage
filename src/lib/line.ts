import { createHmac, timingSafeEqual } from 'node:crypto'

import { env, features } from './env'

/**
 * LINE Messaging API。
 *
 * 刻意不用官方 SDK，直接打 REST API：
 * 簽章驗證是「誰能批准寄信給客戶」的唯一防線，這段程式碼必須
 * 一眼看得懂在做什麼，不該藏在第三方套件裡。
 *
 * 計費差異很重要：
 *   push message  —— 計入每月免費額度
 *   reply message —— 不計入額度（但 replyToken 只能用一次、約 1 分鐘內有效）
 * 所以所有按鈕回覆一律用 reply，主動通知才用 push。
 */

const API = 'https://api.line.me/v2/bot'

export type LineResult =
  | { ok: true }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped?: false; error: string }

async function call(path: string, body: unknown): Promise<LineResult> {
  try {
    const response = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const text = await response.text()
      return { ok: false, error: `LINE API ${response.status}: ${text}` }
    }
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** 主動推播給管理者（計入免費額度） */
export async function pushToOwner(
  messages: LineMessage[],
): Promise<LineResult> {
  if (!features.line) {
    return { ok: false, skipped: true, reason: '尚未設定 LINE channel' }
  }
  if (!env.LINE_ADMIN_USER_ID) {
    return { ok: false, skipped: true, reason: '尚未設定 LINE_ADMIN_USER_ID' }
  }
  return call('/message/push', {
    to: env.LINE_ADMIN_USER_ID,
    messages,
  })
}

/** 回覆 webhook 事件（不計入額度，但 replyToken 一次性且會過期） */
export async function reply(
  replyToken: string,
  messages: LineMessage[],
): Promise<LineResult> {
  if (!features.line) {
    return { ok: false, skipped: true, reason: '尚未設定 LINE channel' }
  }
  return call('/message/reply', { replyToken, messages })
}

/* ------------------------------------------------------------------ */
/* 簽章驗證                                                             */
/* ------------------------------------------------------------------ */

/**
 * 驗證 X-Line-Signature。
 *
 * 必須用「原始 request body 的 bytes」計算，不能先 JSON.parse 再
 * stringify —— 任何空白或鍵順序的差異都會讓簽章對不起來。
 */
export function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!signature || !env.LINE_CHANNEL_SECRET) return false
  const expected = createHmac('sha256', env.LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest('base64')
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * 是否為管理者本人。
 *
 * 沒有這道檢查，任何加了官方帳號好友的人只要猜到 postback 格式，
 * 就能讓系統寄報價單給你的客戶。
 */
export function isAdmin(userId: string | undefined): boolean {
  if (!env.LINE_ADMIN_USER_ID) return false
  return userId === env.LINE_ADMIN_USER_ID
}

/* ------------------------------------------------------------------ */
/* 訊息型別與建構                                                        */
/* ------------------------------------------------------------------ */

export type LineMessage =
  | { type: 'text'; text: string }
  | { type: 'flex'; altText: string; contents: unknown }

export function text(value: string): LineMessage {
  // LINE 單則文字訊息上限 5000 字元
  return { type: 'text', text: value.slice(0, 5000) }
}

export type WebhookEvent = {
  type: string
  replyToken?: string
  source?: { userId?: string; type?: string }
  postback?: { data?: string }
  message?: { type?: string; text?: string }
}

export function parseWebhook(rawBody: string): WebhookEvent[] {
  try {
    const parsed = JSON.parse(rawBody) as { events?: WebhookEvent[] }
    return Array.isArray(parsed.events) ? parsed.events : []
  } catch {
    return []
  }
}

/** postback data 格式：act=approve&t=<token> */
export function parsePostback(data: string | undefined): {
  act: string | null
  token: string | null
} {
  if (!data) return { act: null, token: null }
  const params = new URLSearchParams(data)
  return { act: params.get('act'), token: params.get('t') }
}
