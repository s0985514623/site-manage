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
