import { and, eq, gt, isNull } from 'drizzle-orm'

import { db } from '@/db'
import { approvals, quotes, type Quote } from '@/db/schema'
import { randomToken, sha256 } from './crypto'

/**
 * LINE 一次性審核 token。
 *
 * 這是整個系統唯一會自動對外寄信的觸發點，所以防呆做滿：
 *
 * 1. 資料庫只存 sha256(token)，明文只存在於推給你的那則 LINE 訊息裡。
 *    資料庫外洩也無法偽造出可用的批准連結。
 * 2. 消耗 token 用「UPDATE ... WHERE used_at IS NULL」的單一語句，
 *    由資料庫保證原子性。不是先 SELECT 檢查再 UPDATE ——
 *    那樣在兩次點擊幾乎同時送達時會雙雙通過，寄出兩封信。
 * 3. 每張報價單同時只能有一個未使用的 token（部分唯一索引保證）。
 */

const TTL_DAYS = 7

export async function createApproval(quoteId: string): Promise<string> {
  const token = randomToken(32)
  const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000)

  // 先作廢同一張單尚未使用的舊 token，否則部分唯一索引會擋下新的
  await db
    .update(approvals)
    .set({ usedAt: new Date(), action: 'reject' })
    .where(and(eq(approvals.quoteId, quoteId), isNull(approvals.usedAt)))

  await db.insert(approvals).values({
    quoteId,
    tokenHash: sha256(token),
    expiresAt,
  })

  return token
}

export type ConsumeResult =
  | { ok: true; quote: Quote }
  | { ok: false; reason: 'not_found' | 'already_used' | 'expired' | 'bad_state' }

/**
 * 原子性地消耗 token。
 *
 * 回傳 ok:false 時呼叫端必須「不寄信」並回覆說明，
 * 絕不可以再自行判斷要不要放行。
 */
export async function consumeApproval(
  token: string,
  action: 'approve' | 'reject',
  lineUserId: string,
): Promise<ConsumeResult> {
  const tokenHash = sha256(token)

  // 單一語句完成檢查與消耗：影響 0 列即代表不存在、已用過或已過期
  const [consumed] = await db
    .update(approvals)
    .set({ usedAt: new Date(), action, usedByLineUserId: lineUserId })
    .where(
      and(
        eq(approvals.tokenHash, tokenHash),
        isNull(approvals.usedAt),
        gt(approvals.expiresAt, new Date()),
      ),
    )
    .returning()

  if (!consumed) {
    // 區分「從未存在」與「已用過／已過期」，讓回覆訊息能說清楚
    const existing = await db.query.approvals.findFirst({
      where: eq(approvals.tokenHash, tokenHash),
    })
    if (!existing) return { ok: false, reason: 'not_found' }
    if (existing.usedAt) return { ok: false, reason: 'already_used' }
    return { ok: false, reason: 'expired' }
  }

  const quote = await db.query.quotes.findFirst({
    where: eq(quotes.id, consumed.quoteId),
  })

  // 狀態機守衛：即使 token 有效，報價單也必須還在等待確認的狀態
  if (!quote) return { ok: false, reason: 'not_found' }
  if (quote.status !== 'pending_approval') {
    return { ok: false, reason: 'bad_state' }
  }

  return { ok: true, quote }
}

export const CONSUME_MESSAGE: Record<
  Exclude<ConsumeResult, { ok: true }>['reason'],
  string
> = {
  not_found: '找不到這筆確認要求，可能是訊息太舊了。請到後台重新產生報價單。',
  already_used: '這張報價單已經處理過了，沒有重複寄出。',
  expired: '這筆確認要求已超過 7 天有效期。請到後台重新產生報價單。',
  bad_state: '這張報價單的狀態已經變更（可能已在後台處理過），因此沒有寄出。',
}
