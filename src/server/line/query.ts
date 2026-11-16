import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm'

import { db } from '@/db'
import { clients, projects, quotes, services, sites } from '@/db/schema'
import { daysUntil, plusDays, today } from '@/lib/dates'
import { env } from '@/lib/env'
import { STATUS_LABEL } from '@/server/projects/projects'

/**
 * LINE 選單的三種查詢。一律以 reply 回覆（不計推播額度），每種最多列 5 筆，
 * 超過時附後台連結。
 */

export type QueryKind = 'expiring' | 'quotes' | 'projects'

const LIMIT = 5
/** 「近期到期」= 30 天內到期（含已逾期） */
const EXPIRING_WINDOW_DAYS = 30

/** 2026-12-31 → 12/31 */
export function shortDate(date: string): string {
  const [, m, d] = date.split('-')
  return `${Number(m)}/${Number(d)}`
}

function more(total: number, path: string): string[] {
  return total > LIMIT ? [`還有 ${total - LIMIT} 筆，查看全部：${env.APP_URL}${path}`] : []
}

async function expiring(): Promise<string> {
  const now = today()
  const rows = await db
    .select({
      identifier: services.identifier,
      expiresAt: services.expiresAt,
      siteName: sites.name,
      clientName: clients.name,
    })
    .from(services)
    .innerJoin(sites, eq(services.siteId, sites.id))
    .innerJoin(clients, eq(sites.clientId, clients.id))
    .where(and(eq(services.status, 'active'), lte(services.expiresAt, plusDays(now, EXPIRING_WINDOW_DAYS))))
    .orderBy(asc(services.expiresAt))

  if (rows.length === 0) return `【近期到期】\n${EXPIRING_WINDOW_DAYS} 天內沒有到期的項目。`
  const lines = rows.slice(0, LIMIT).map((r) => {
    const days = daysUntil(r.expiresAt, now)
    const left = days < 0 ? `逾期 ${-days} 天` : days === 0 ? '今天到期' : `${days} 天`
    return `· ${r.identifier} ${r.expiresAt}（${left}）\n  ${r.clientName} / ${r.siteName}`
  })
  return [`【近期到期】${rows.length} 筆`, ...lines, ...more(rows.length, '/services')].join('\n')
}

async function pendingQuotes(): Promise<string> {
  const rows = await db
    .select({ quoteNo: quotes.quoteNo, status: quotes.status, paidOn: quotes.paidOn })
    .from(quotes)
    .where(inArray(quotes.status, ['pending_approval', 'sent', 'accepted']))
    .orderBy(desc(quotes.quoteNo))

  const group = (filter: (r: (typeof rows)[number]) => boolean) => {
    const list = rows.filter(filter).map((r) => r.quoteNo)
    if (list.length === 0) return '無'
    return list.slice(0, LIMIT).join('、') + (list.length > LIMIT ? ` 等 ${list.length} 張` : '')
  }
  const pending = group((r) => r.status === 'pending_approval')
  const unanswered = group((r) => r.status === 'sent')
  const unpaid = group((r) => r.status === 'accepted' && !r.paidOn)
  return [
    '【待處理報價】',
    `待確認：${pending}；未回覆：${unanswered}；未收款：${unpaid}`,
    '',
    `${env.APP_URL}/quotes`,
  ].join('\n')
}

async function activeProjects(): Promise<string> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      dueDate: projects.dueDate,
      clientName: clients.name,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(inArray(projects.status, ['not_started', 'in_progress', 'in_review']))
    .orderBy(asc(projects.dueDate), asc(projects.name))

  if (rows.length === 0) return '【進行中專案】\n目前沒有未完成的專案。'
  const now = today()
  const lines = rows.slice(0, LIMIT).map((p) => {
    const due = p.dueDate
      ? `${shortDate(p.dueDate)} 截止${p.dueDate < now ? '，已逾期' : ''}`
      : '未設截止日'
    return `· ${p.name}（${STATUS_LABEL[p.status]}，${due}）\n  ${p.clientName}`
  })
  return [`【進行中專案】${rows.length} 個`, ...lines, ...more(rows.length, '/projects')].join('\n')
}

export async function answerQuery(kind: string): Promise<string> {
  if (kind === 'expiring') return expiring()
  if (kind === 'quotes') return pendingQuotes()
  if (kind === 'projects') return activeProjects()
  return '無法辨識的查詢。'
}
