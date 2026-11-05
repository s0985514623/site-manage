import { db } from '@/db'
import { activityLogs } from '@/db/schema'

/**
 * 稽核紀錄。
 *
 * 重點記錄兩類事件：
 * 1. 對外送出的動作（寄出報價單）—— 出事時要能回溯是誰、何時、寄給誰
 * 2. 敏感資料存取（顯示主機帳密明文）
 *
 * 寫入失敗不應該中斷主流程：稽核失敗而導致報價單寄不出去，是本末倒置。
 */
export async function logActivity(
  actor: string,
  action: string,
  entityType?: string | null,
  entityId?: string | null,
  detail?: unknown,
): Promise<void> {
  try {
    await db.insert(activityLogs).values({
      actor,
      action,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      detail: detail === undefined ? null : detail,
    })
  } catch (error) {
    console.error('[activity] 寫入稽核紀錄失敗', { action, error })
  }
}
