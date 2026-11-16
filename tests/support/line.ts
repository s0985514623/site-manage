import { createHmac } from 'node:crypto'

/** 以 LINE 平台的身分呼叫 webhook（帶正確簽章） */
export async function LINE事件(events: unknown[]) {
  const { POST } = await import('@/app/api/line/webhook/route')
  const body = JSON.stringify({ events })
  const signature = createHmac('sha256', process.env.LINE_CHANNEL_SECRET!).update(body).digest('base64')
  const response = await POST(
    new Request('https://site.test/api/line/webhook', {
      method: 'POST',
      headers: { 'x-line-signature': signature, 'content-type': 'application/json' },
      body,
    }),
  )
  return response.status
}

export const 管理者 = () => process.env.LINE_ADMIN_USER_ID!

export function postback(data: string, userId = 管理者()) {
  return { type: 'postback', replyToken: 'reply-token', source: { userId, type: 'user' }, postback: { data } }
}

export function 文字訊息(text: string, userId = 管理者()) {
  return { type: 'message', replyToken: 'reply-token', source: { userId, type: 'user' }, message: { type: 'text', text } }
}

export const 非管理者 = 'Ustranger00000000000000000000000'

/** 日期選擇器選了日期 */
export function 選日期(date: string, userId = 管理者()) {
  return { type: 'postback', replyToken: 'reply-token', source: { userId, type: 'user' }, postback: { data: 'due', params: { date } } }
}

/** 規格的「管理者在 LINE 傳送」：type = postback / message / datetime */
export function 傳送(type: string, value: string, userId = 管理者()) {
  if (type === 'message') return 文字訊息(value, userId)
  if (type === 'datetime') return 選日期(value, userId)
  return postback(value, userId)
}
