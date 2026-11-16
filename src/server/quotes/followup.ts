import { and, desc, eq, isNotNull } from 'drizzle-orm'

import { db } from '@/db'
import { clients, quotes } from '@/db/schema'
import { daysUntil, today } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { getSettings } from '@/lib/settings'
import { isReminderDay, sendReminders, taipeiDate, type ReminderItem } from './reminders'

/**
 * 報價未回覆追蹤：狀態仍為「已寄出」，寄出滿 N 天提醒、之後每 N 天再提醒，
 * 直到狀態改變。過了有效期不自動改狀態，只在提醒裡標示。
 */
export async function runQuoteFollowup(dryRun: boolean) {
  const config = await getSettings()
  const every = config.quoteFollowupDays
  const now = today()

  const rows = await db
    .select({
      id: quotes.id,
      quoteNo: quotes.quoteNo,
      sentAt: quotes.sentAt,
      validUntil: quotes.validUntil,
      total: quotes.total,
      currency: quotes.currency,
      clientName: clients.name,
    })
    .from(quotes)
    .innerJoin(clients, eq(quotes.clientId, clients.id))
    .where(and(eq(quotes.status, 'sent'), isNotNull(quotes.sentAt)))
    .orderBy(desc(quotes.sentAt), desc(quotes.quoteNo))

  const candidates: ReminderItem[] = []
  for (const q of rows) {
    const sentOn = taipeiDate(q.sentAt!)
    // 寄出當天不算：滿 N 天才第一次提醒
    if (sentOn === now || !isReminderDay(sentOn, every)) continue
    const days = -daysUntil(sentOn)
    const expired = q.validUntil < now
    candidates.push({
      quoteId: q.id,
      quoteNo: q.quoteNo,
      flag: expired ? '（已過有效期）' : undefined,
      detail: `${q.quoteNo} ${q.clientName} ${formatMoney(q.total, q.currency)}，寄出 ${days} 天未回覆`,
    })
  }

  const result = await sendReminders('quote_followup', '報價追蹤', candidates, dryRun)
  return { followupDays: every, ...result }
}
