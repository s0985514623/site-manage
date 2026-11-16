import { logActivity } from '@/lib/activity'
import {
  CONSUME_MESSAGE,
  consumeApproval,
} from '@/lib/approvals'
import { env, features } from '@/lib/env'
import {
  isAdmin,
  parsePostback,
  parseWebhook,
  reply,
  text,
  verifySignature,
  type WebhookEvent,
} from '@/lib/line'
import { getSettings } from '@/lib/settings'
import { cancelQuote, sendQuoteToClient } from '@/server/send-quote'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * LINE webhook —— 系統唯一會觸發「自動寄信給客戶」的入口。
 *
 * 四道關卡，缺一不可，任何一道不過就絕不寄信：
 *
 *   1. X-Line-Signature 驗證（擋偽造請求）
 *   2. userId 必須是 LINE_ADMIN_USER_ID（否則任何加你好友的人
 *      只要猜到 postback 格式就能讓系統寄報價單給你的客戶）
 *   3. 一次性 token 的原子消耗（手滑連點兩下不會寄出兩封）
 *   4. 報價單狀態必須仍是 pending_approval
 *
 * 回覆一律用 reply message：不計入 LINE 每月推播額度。
 */
export async function POST(request: Request) {
  // 簽章必須用原始 bytes 計算，不能 parse 過再 stringify
  const rawBody = await request.text()
  const signature = request.headers.get('x-line-signature')

  if (!features.line) {
    // 尚未設定 channel secret 時無法驗證簽章，一律拒絕
    return Response.json({ error: 'line not configured' }, { status: 503 })
  }

  if (!verifySignature(rawBody, signature)) {
    console.warn('[line] 簽章驗證失敗，已拒絕請求')
    return Response.json({ error: 'invalid signature' }, { status: 401 })
  }

  const events = parseWebhook(rawBody)

  // LINE 要求 webhook 快速回 200，否則會重送。逐一處理但不讓單一
  // 事件的錯誤拖垮整批。
  for (const event of events) {
    try {
      await handleEvent(event)
    } catch (error) {
      console.error('[line] 處理事件失敗', error)
    }
  }

  return Response.json({ ok: true })
}

async function handleEvent(event: WebhookEvent): Promise<void> {
  const userId = event.source?.userId

  /**
   * 設定用途：第一次串接時你需要知道自己的 userId 才能填
   * LINE_ADMIN_USER_ID。尚未設定時，對任何訊息回覆該 userId；
   * 一旦設定完成，這個分支就不再對外洩漏任何東西。
   */
  if (event.type === 'message' && event.replyToken) {
    if (!env.LINE_ADMIN_USER_ID) {
      await reply(event.replyToken, [
        text(
          `你的 LINE userId 是：\n${userId ?? '（取得失敗）'}\n\n` +
            '請把它填入 .env.local 的 LINE_ADMIN_USER_ID 後重新啟動，' +
            '之後才能用 LINE 確認報價單。',
        ),
      ])
      return
    }
    if (isAdmin(userId)) {
      await reply(event.replyToken, [
        text('系統運作中。報價單需要確認時會主動推播給你。'),
      ])
    }
    return
  }

  if (event.type !== 'postback' || !event.replyToken) return

  /* ---------- 關卡 2：必須是管理者本人 ---------- */
  if (!isAdmin(userId)) {
    console.warn('[line] 非管理者嘗試操作 postback', { userId })
    await logActivity(`line:${userId ?? 'unknown'}`, 'line.unauthorized_postback')
    await reply(event.replyToken, [
      text('這個帳號沒有操作權限。'),
    ])
    return
  }

  const { act, token } = parsePostback(event.postback?.data)
  if (!act || !token) {
    await reply(event.replyToken, [text('無法辨識的操作。')])
    return
  }
  if (act !== 'approve' && act !== 'reject') {
    await reply(event.replyToken, [text('無法辨識的操作。')])
    return
  }

  /**
   * 寄送模式：手動寄時 LINE 的確認按鈕不寄信（設定頁可能是在推播之後才切換的）。
   * 在消耗 token 之前檢查，token 留著，切回自動寄後仍可使用。
   */
  if (act === 'approve' && !(await getSettings()).autoSendEnabled) {
    await reply(event.replyToken, [
      text(`目前為手動寄送模式，請至後台按寄出：\n${env.APP_URL}/quotes`),
    ])
    return
  }

  /* ---------- 關卡 3 + 4：原子消耗 token 並檢查狀態 ---------- */
  const consumed = await consumeApproval(token, act, userId!)
  if (!consumed.ok) {
    await reply(event.replyToken, [text(CONSUME_MESSAGE[consumed.reason])])
    return
  }

  const actor = `line:${userId}`
  const quote = consumed.quote

  if (act === 'reject') {
    const result = await cancelQuote(quote.id, actor)
    await reply(event.replyToken, [
      text(
        result.ok
          ? `已取消 ${result.quoteNo}，沒有寄出任何信件。\n` +
            '相關項目已放回待處理，下個週期會重新擬草稿。'
          : `取消失敗：${result.error}`,
      ),
    ])
    return
  }

  /* ---------- 通過全部關卡，寄信 ---------- */
  const result = await sendQuoteToClient(quote.id, actor)

  if (result.ok) {
    await reply(event.replyToken, [
      text(
        `已寄出 ${result.quoteNo}（${result.total}）\n\n` +
          `收件人：\n${result.recipients.map((r) => `· ${r}`).join('\n')}\n\n` +
          `客戶回覆後，記得到後台標記結果：\n${env.APP_URL}/quotes/${quote.id}`,
      ),
    ])
  } else {
    /**
     * 寄信失敗要把報價單退回草稿，否則它會卡在 pending_approval
     * 而 token 已經用掉，變成再也無法處理的死狀態。
     */
    const { db } = await import('@/db')
    const { quotes } = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')
    await db
      .update(quotes)
      .set({ status: 'draft', updatedAt: new Date() })
      .where(eq(quotes.id, quote.id))

    await reply(event.replyToken, [
      text(
        `寄送失敗，沒有任何信件送出。\n\n${result.error}\n\n` +
          `報價單已退回草稿，請到後台處理：\n${env.APP_URL}/quotes/${quote.id}`,
      ),
    ])
  }
}

/** LINE Console 的 Verify 按鈕會送 GET */
export async function GET() {
  return Response.json({ ok: true, endpoint: 'line webhook' })
}
