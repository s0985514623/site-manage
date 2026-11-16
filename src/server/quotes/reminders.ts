import { and, eq, inArray } from 'drizzle-orm'
import { formatInTimeZone } from 'date-fns-tz'

import { db } from '@/db'
import { notifications } from '@/db/schema'
import { daysUntil, TIMEZONE, today } from '@/lib/dates'
import { env, features } from '@/lib/env'
import { pushToOwner, text } from '@/lib/line'
import { countLinePush, linePushAllowed } from '@/lib/line-quota'
import { emailLayout, escapeHtml, notifyOwner } from '@/lib/mailer'

/**
 * 報價追蹤 / 收款追蹤共用的「挑出今天要提醒的、去重、彙總成一則、寫紀錄」流程。
 *
 *   候選 → 去掉今天已提醒過的 → 一則 LINE（額度不足改 Email）→ 寫 notifications
 *
 * 去重靠 notifications 的部分唯一索引 (kind, quote_id, channel, sent_on)，
 * 同一天重跑排程不會重複推播。
 */

export type ReminderKind = 'quote_followup' | 'payment_followup'

export type ReminderItem = {
  quoteId: string
  quoteNo: string
  /** 摘要行的標示，例如「（已過有效期）」 */
  flag?: string
  /** 詳細行 */
  detail: string
}

/** timestamptz → 台北日期 */
export function taipeiDate(value: Date): string {
  return formatInTimeZone(value, TIMEZONE, 'yyyy-MM-dd')
}

/** 從 start 起算、每隔 every 天的那幾天（含 start 當天）為 true */
export function isReminderDay(start: string, every: number, on: string = today()): boolean {
  const elapsed = -daysUntil(start, on)
  return elapsed >= 0 && elapsed % every === 0
}

export async function sendReminders(
  kind: ReminderKind,
  title: string,
  candidates: ReminderItem[],
  dryRun: boolean,
): Promise<{ reminded: string[]; channel: 'line' | 'email' | null; skippedAlreadySent: number; error?: string }> {
  const sentOn = today()
  if (candidates.length === 0) return { reminded: [], channel: null, skippedAlreadySent: 0 }

  const already = await db
    .select({ quoteId: notifications.quoteId })
    .from(notifications)
    .where(
      and(
        eq(notifications.kind, kind),
        eq(notifications.sentOn, sentOn),
        inArray(
          notifications.quoteId,
          candidates.map((c) => c.quoteId),
        ),
      ),
    )
  const done = new Set(already.map((r) => r.quoteId))
  const items = candidates.filter((c) => !done.has(c.quoteId))
  const skippedAlreadySent = candidates.length - items.length
  if (items.length === 0 || dryRun) {
    return { reminded: items.map((i) => i.quoteNo), channel: null, skippedAlreadySent }
  }

  const summary = items.map((i) => `${i.quoteNo}${i.flag ?? ''}`).join('、')
  const body = [
    `[${title}] ${summary}`,
    '',
    ...items.map((i) => `· ${i.detail}`),
    '',
    `${env.APP_URL}/quotes`,
  ].join('\n')

  let channel: 'line' | 'email' = 'line'
  let ok = false
  let error: string | undefined

  if (features.lineApproval && (await linePushAllowed())) {
    const result = await pushToOwner([text(body)])
    ok = result.ok
    if (result.ok) await countLinePush(1)
    else error = 'error' in result ? result.error : result.reason
  }

  if (!ok) {
    // LINE 未設定、額度不足或推播失敗：改寄 Email 給自己
    channel = 'email'
    const mail = await notifyOwner({
      subject: `[網站續約] ${title}：${items.length} 張報價單`,
      html: emailLayout(
        title,
        `<ul style="padding-left:20px;">${items
          .map((i) => `<li><strong>${escapeHtml(i.quoteNo)}${escapeHtml(i.flag ?? '')}</strong> ${escapeHtml(i.detail)}</li>`)
          .join('')}</ul>
         <p><a href="${env.APP_URL}/quotes">開啟報價單列表</a></p>`,
      ),
      text: body,
    })
    ok = mail.ok
    if (!mail.ok) error = 'error' in mail ? mail.error : mail.reason
  }

  await db
    .insert(notifications)
    .values(items.map((i) => ({ kind, quoteId: i.quoteId, channel, sentOn, ok, error: ok ? null : (error ?? null) })))
    .onConflictDoNothing()

  return { reminded: items.map((i) => i.quoteNo), channel, skippedAlreadySent, ...(ok ? {} : { error }) }
}
