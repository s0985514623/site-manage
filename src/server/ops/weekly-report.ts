import { and, asc, between, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm'

import { db } from '@/db'
import { notifications, projectMilestones, projects, quotes, services } from '@/db/schema'
import { plusDays, today } from '@/lib/dates'
import { env, features } from '@/lib/env'
import { pushToOwner, text } from '@/lib/line'
import { countLinePush, linePushAllowed } from '@/lib/line-quota'
import { emailLayout, escapeHtml, notifyOwner } from '@/lib/mailer'
import { shortDate } from '@/server/line/query'

/**
 * 每週一 09:00 的 LINE 週報：本週到期、待處理報價、本週專案截止與里程碑。
 *
 * 沒有待辦也推「本週無待辦」——這則訊息同時是系統還活著的訊號，
 * 週一沒收到就代表排程或主機出了問題。同一天重跑不重複推送。
 */

/** 「本週」= 週一開始的 7 天（含當天）。排程在週一跑，所以就是今天起 7 天 */
export function thisWeek(on: string = today()) {
  const d = new Date(`${on}T00:00:00Z`)
  const offset = (d.getUTCDay() + 6) % 7 // 週一 = 0
  const start = plusDays(on, -offset)
  return { start, end: plusDays(start, 6) }
}

export async function buildWeeklyReport(on: string = today()): Promise<string[]> {
  const { start, end } = thisWeek(on)

  const [expiring, quoteRows, projectRows, milestoneRows] = await Promise.all([
    db
      .select({ identifier: services.identifier, expiresAt: services.expiresAt })
      .from(services)
      .where(and(eq(services.status, 'active'), between(services.expiresAt, start, end)))
      .orderBy(asc(services.expiresAt)),
    db
      .select({ quoteNo: quotes.quoteNo, status: quotes.status, paidOn: quotes.paidOn })
      .from(quotes)
      .where(inArray(quotes.status, ['pending_approval', 'sent', 'accepted']))
      .orderBy(desc(quotes.quoteNo)),
    db
      .select({ name: projects.name, dueDate: projects.dueDate })
      .from(projects)
      .where(and(ne(projects.status, 'completed'), between(projects.dueDate, start, end)))
      .orderBy(asc(projects.dueDate)),
    // 與本週重疊：開始日（里程碑用當天）<= 週日，且結束日 >= 週一
    db
      .select({ name: projectMilestones.name, startOn: projectMilestones.startOn, dueOn: projectMilestones.dueOn })
      .from(projectMilestones)
      .where(
        and(
          isNull(projectMilestones.completedAt),
          lte(sql`coalesce(${projectMilestones.startOn}, ${projectMilestones.dueOn})`, end),
          gte(projectMilestones.dueOn, start),
        ),
      )
      .orderBy(asc(projectMilestones.dueOn)),
  ])

  const list = <T,>(rows: T[], fmt: (r: T) => string) => rows.map(fmt).join('、')
  const lines: string[] = []
  if (expiring.length) lines.push(`本週到期：${list(expiring, (s) => `${s.identifier} ${shortDate(s.expiresAt)}`)}`)

  const pending = quoteRows.filter((q) => q.status === 'pending_approval')
  const unanswered = quoteRows.filter((q) => q.status === 'sent')
  const unpaid = quoteRows.filter((q) => q.status === 'accepted' && !q.paidOn)
  if (pending.length) lines.push(`待確認報價：${list(pending, (q) => q.quoteNo)}`)
  if (unanswered.length) lines.push(`未回覆報價：${list(unanswered, (q) => q.quoteNo)}`)
  if (unpaid.length) lines.push(`未收款報價：${list(unpaid, (q) => q.quoteNo)}`)

  if (projectRows.length) lines.push(`專案截止：${list(projectRows, (p) => `${p.name} ${shortDate(p.dueDate!)}`)}`)
  const ranges = milestoneRows.filter((m) => m.startOn)
  const points = milestoneRows.filter((m) => !m.startOn)
  if (ranges.length) {
    lines.push(`時程：${list(ranges, (m) => `${m.name} ${shortDate(m.startOn!)}–${shortDate(m.dueOn)}`)}`)
  }
  if (points.length) lines.push(`里程碑：${list(points, (m) => `${m.name} ${shortDate(m.dueOn)}`)}`)

  return lines
}

export async function runWeeklyReport(dryRun: boolean) {
  const sentOn = today()
  const { start, end } = thisWeek(sentOn)
  const lines = await buildWeeklyReport(sentOn)
  const body = [
    `[週報] ${shortDate(start)}–${shortDate(end)}`,
    '',
    ...(lines.length ? lines : ['本週無待辦。']),
    '',
    env.APP_URL,
  ].join('\n')

  const [already] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.kind, 'weekly_report'), eq(notifications.sentOn, sentOn)))
    .limit(1)
  if (already) return { skipped: '今天已推送過週報', lines }
  if (dryRun) return { dryRun: true, body }

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
    channel = 'email'
    const mail = await notifyOwner({
      subject: `[網站續約] 每週週報 ${shortDate(start)}–${shortDate(end)}`,
      html: emailLayout(
        '每週週報',
        `<ul style="padding-left:20px;">${(lines.length ? lines : ['本週無待辦。'])
          .map((l) => `<li>${escapeHtml(l)}</li>`)
          .join('')}</ul><p><a href="${env.APP_URL}">開啟後台</a></p>`,
      ),
      text: body,
    })
    ok = mail.ok
    if (!mail.ok) error = 'error' in mail ? mail.error : mail.reason
  }

  await db
    .insert(notifications)
    .values({ kind: 'weekly_report', channel, sentOn, ok, error: ok ? null : (error ?? null) })
    .onConflictDoNothing()

  return { channel, ok, lines, ...(error ? { error } : {}) }
}
