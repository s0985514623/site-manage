import { and, eq, inArray } from 'drizzle-orm'

import { db } from '@/db'
import { notifications } from '@/db/schema'
import {
  OVERDUE_LEVEL,
  daysUntil,
  describeDays,
  formatTw,
  noticeLevelFor,
  today,
  urgencyOf,
  type Urgency,
} from '@/lib/dates'
import { escapeHtml } from '@/lib/mailer'
import { SERVICE_TYPE_LABEL } from '@/lib/labels'
import { listActiveServices, type ServiceRow } from './queries'

/**
 * 每日到期掃描。
 *
 * 設計重點：
 * 1. 彙總成「一封信 + 一則 LINE」，不是每筆一則。
 *    十個項目同時進入提醒門檻時，十則通知只會讓人直接忽略。
 * 2. 以 (service, level, channel, 日期) 去重，避免同一天重複寄。
 * 3. 逾期項目每天都提醒 —— 網域進入贖回期的代價太高，
 *    不能因為「昨天提醒過了」就安靜下來。
 */

export type Notice = {
  service: ServiceRow
  days: number
  level: number
  urgency: Urgency
}

export type ScanResult = {
  scannedAt: string
  totalActive: number
  notices: Notice[]
  /** 已達門檻但今天已通知過，因此略過的數量 */
  skippedAlreadySent: number
}

/** 找出今天該提醒、且尚未提醒過的項目 */
export async function collectNotices(
  channel: 'email' | 'line' = 'email',
): Promise<ScanResult> {
  const scannedAt = today()
  const all = await listActiveServices()

  const candidates: Notice[] = []
  for (const service of all) {
    const days = daysUntil(service.expiresAt, scannedAt)
    const level = noticeLevelFor(days)
    if (level === null) continue
    candidates.push({ service, days, level, urgency: urgencyOf(days) })
  }

  if (candidates.length === 0) {
    return { scannedAt, totalActive: all.length, notices: [], skippedAlreadySent: 0 }
  }

  // 一次查出今天已送過的紀錄，避免逐筆查詢
  const sentToday = await db
    .select({
      serviceId: notifications.serviceId,
      level: notifications.level,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.kind, 'expiry'),
        eq(notifications.sentOn, scannedAt),
        eq(notifications.channel, channel),
        eq(notifications.ok, true),
        inArray(
          notifications.serviceId,
          candidates.map((c) => c.service.id),
        ),
      ),
    )

  const already = new Set(sentToday.map((r) => `${r.serviceId}:${r.level}`))
  const notices = candidates.filter(
    (c) => !already.has(`${c.service.id}:${c.level}`),
  )

  return {
    scannedAt,
    totalActive: all.length,
    notices: notices.sort((a, b) => a.days - b.days),
    skippedAlreadySent: candidates.length - notices.length,
  }
}

/** 記錄已送出，讓同一天不會重複通知 */
export async function recordNotifications(
  notices: Notice[],
  channel: 'email' | 'line',
  sentOn: string,
  ok: boolean,
  error?: string,
): Promise<void> {
  if (notices.length === 0) return
  await db
    .insert(notifications)
    .values(
      notices.map((n) => ({
        kind: 'expiry' as const,
        serviceId: n.service.id,
        level: n.level,
        channel,
        sentOn,
        ok,
        error: error ?? null,
      })),
    )
    // 併發執行兩次 cron 時，唯一索引會擋下重複，直接忽略即可
    .onConflictDoNothing()
}

/* ------------------------------------------------------------------ */
/* 訊息組裝                                                             */
/* ------------------------------------------------------------------ */

const SECTION_ORDER: { urgency: Urgency; label: string; color: string }[] = [
  { urgency: 'overdue', label: '已逾期', color: '#d92d20' },
  { urgency: 'critical', label: '14 天內到期', color: '#dc6803' },
  { urgency: 'warning', label: '30 天內到期', color: '#b54708' },
  { urgency: 'upcoming', label: '90 天內到期', color: '#175cd3' },
]

function groupNotices(notices: Notice[]) {
  return SECTION_ORDER.map((section) => ({
    ...section,
    items: notices.filter((n) => n.urgency === section.urgency),
  })).filter((s) => s.items.length > 0)
}

export function buildEmailSubject(notices: Notice[]): string {
  const overdue = notices.filter((n) => n.level === OVERDUE_LEVEL).length
  const soon = notices.filter((n) => n.days >= 0 && n.days <= 30).length
  const parts: string[] = []
  if (overdue > 0) parts.push(`${overdue} 項已逾期`)
  if (soon > 0) parts.push(`${soon} 項 30 天內到期`)
  if (parts.length === 0) parts.push(`${notices.length} 項到期提醒`)
  return `[網站續約] ${parts.join('、')}`
}

export function buildEmailBody(notices: Notice[], appUrl: string): string {
  const groups = groupNotices(notices)

  const sections = groups
    .map((group) => {
      const rows = group.items
        .map((n) => {
          const s = n.service
          const owner = s.isOurs ? '' : '（客戶自管）'
          const price =
            s.isOurs && !s.priceAmount
              ? '<span style="color:#b54708;">未設售價</span>'
              : ''
          return `<tr>
  <td style="padding:8px 12px 8px 0;border-bottom:1px solid #eef0f2;">
    <strong>${escapeHtml(s.identifier)}</strong>
    <span style="color:#667085;font-size:12px;">${SERVICE_TYPE_LABEL[s.type]}${owner}</span>
    <div style="color:#667085;font-size:12px;margin-top:2px;">
      ${escapeHtml(s.clientName)} · ${escapeHtml(s.siteName)}
    </div>
  </td>
  <td style="padding:8px 0;border-bottom:1px solid #eef0f2;text-align:right;white-space:nowrap;">
    <div style="font-variant-numeric:tabular-nums;">${formatTw(s.expiresAt)}</div>
    <div style="color:${group.color};font-size:12px;font-weight:700;">${describeDays(n.days)}</div>
    ${price}
  </td>
</tr>`
        })
        .join('')

      return `<div style="margin-bottom:24px;">
  <div style="display:inline-block;padding:4px 10px;border-radius:6px;background:${group.color}1a;color:${group.color};font-size:13px;font-weight:700;margin-bottom:8px;">
    ${group.label}（${group.items.length}）
  </div>
  <table style="width:100%;border-collapse:collapse;">${rows}</table>
</div>`
    })
    .join('')

  const overdueWarning = groups.some((g) => g.urgency === 'overdue')
    ? `<div style="margin-bottom:20px;padding:12px 14px;border:1px solid #d92d2040;border-radius:8px;background:#fef3f2;color:#d92d20;font-size:13px;">
  <strong>有項目已逾期。</strong>網域過期後通常有約 30 天寬限期、再 30 天贖回期，
  進入贖回期後費用極高（常見 US$100 以上），請優先處理。
</div>`
    : ''

  return `${overdueWarning}${sections}
<p style="margin-top:24px;">
  <a href="${appUrl}/services" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#1f6feb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;">
    開啟到期總表
  </a>
</p>`
}

export function buildEmailText(notices: Notice[]): string {
  return groupNotices(notices)
    .map((group) => {
      const lines = group.items.map((n) => {
        const s = n.service
        return `  ${formatTw(s.expiresAt)}  ${describeDays(n.days)}  ${s.identifier}（${s.clientName} · ${s.siteName}）${s.isOurs ? '' : '［客戶自管］'}`
      })
      return `${group.label}（${group.items.length}）\n${lines.join('\n')}`
    })
    .join('\n\n')
}

/** LINE 文字訊息。手機上看，所以比 Email 更精簡 */
export function buildLineText(notices: Notice[], appUrl: string): string {
  const groups = groupNotices(notices)
  const body = groups
    .map((group) => {
      const icon =
        group.urgency === 'overdue'
          ? '🔴'
          : group.urgency === 'critical'
            ? '🟠'
            : group.urgency === 'warning'
              ? '🟡'
              : '🔵'
      const lines = group.items.map((n) => {
        const s = n.service
        const tag = s.isOurs ? '' : '（客戶自管）'
        return `・${s.identifier}${tag}\n  ${s.clientName} · ${describeDays(n.days)}`
      })
      return `${icon} ${group.label}（${group.items.length}）\n${lines.join('\n')}`
    })
    .join('\n\n')

  return `【網站到期提醒】\n\n${body}\n\n到期總表：\n${appUrl}/services`
}
