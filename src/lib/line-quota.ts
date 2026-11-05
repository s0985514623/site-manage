import { eq, sql } from 'drizzle-orm'

import { db } from '@/db'
import { settings } from '@/db/schema'
import { today } from './dates'
import { getSettings } from './settings'

/**
 * LINE 推播額度管理。
 *
 * 官方帳號免費方案每月推播則數有限（台灣輕用量方案約 200 則），
 * 超出後要付費。這裡自己記帳，接近上限時把每日到期彙總降級成
 * 只寄 Email，把剩餘額度留給真正重要的東西——報價單確認訊息。
 *
 * 額度在每月 1 號重置（LINE 的計費週期以自然月計）。
 */

/** 預留給報價確認的則數，不讓日常通知把額度吃光 */
const RESERVED_FOR_APPROVALS = 20

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`
}

/** 若已跨月則重置計數，回傳目前的用量設定 */
async function currentQuota() {
  const config = await getSettings()
  const thisMonth = monthStart(today())

  if (config.linePushResetAt !== thisMonth) {
    const [reset] = await db
      .update(settings)
      .set({ linePushCount: 0, linePushResetAt: thisMonth, updatedAt: new Date() })
      .where(eq(settings.id, 1))
      .returning()
    return reset
  }
  return config
}

/** 日常通知是否還有額度（保留報價確認的用量） */
export async function linePushAllowed(reserve = RESERVED_FOR_APPROVALS): Promise<boolean> {
  const config = await currentQuota()
  return config.linePushCount + reserve < config.linePushMonthlyLimit
}

/** 報價確認等關鍵推播：只要還沒真的超過上限就送 */
export async function linePushAllowedCritical(): Promise<boolean> {
  const config = await currentQuota()
  return config.linePushCount < config.linePushMonthlyLimit
}

export async function countLinePush(n = 1): Promise<void> {
  await currentQuota()
  await db
    .update(settings)
    .set({
      linePushCount: sql`${settings.linePushCount} + ${n}`,
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1))
}
