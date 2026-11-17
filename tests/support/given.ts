import { eq as eqCol } from 'drizzle-orm'
import { afterEach } from 'vitest'

import { db } from '@/db'
import {
  clients,
  contacts,
  lineConversations,
  notifications,
  oauthTokens,
  projectMilestones,
  projects,
  quoteItems,
  quotes,
  services,
  settings,
  sites,
  type NewService,
} from '@/db/schema'
import { encrypt } from '@/lib/crypto'
import { env } from '@/lib/env'
import { getSettings, updateSettings } from '@/lib/settings'

/**
 * 規格裡共用的 Given 步驟。名稱以客戶 / 網站名稱查找，對應 .feature 的資料表寫法。
 */

export async function 有客戶(name: string, status: 'active' | 'inactive' = 'active') {
  const [row] = await db.insert(clients).values({ name, status }).returning()
  return row
}

export async function 有網站(
  name: string,
  clientName: string,
  status: 'building' | 'live' | 'paused' | 'closed' = 'live',
) {
  const client = await db.query.clients.findFirst({ where: (c, { eq }) => eq(c.name, clientName) })
  if (!client) throw new Error(`測試資料錯誤：找不到客戶 ${clientName}`)
  const [row] = await db.insert(sites).values({ name, clientId: client.id, status }).returning()
  return row
}

export async function 有服務項目(
  siteName: string,
  values: Partial<NewService> & Pick<NewService, 'type' | 'identifier' | 'expiresAt'>,
) {
  const site = await db.query.sites.findFirst({ where: (s, { eq }) => eq(s.name, siteName) })
  if (!site) throw new Error(`測試資料錯誤：找不到網站 ${siteName}`)
  const [row] = await db
    .insert(services)
    .values({ siteId: site.id, status: 'active', ...values })
    .returning()
  return row
}

/** 報價單收件人（規格的 Background 沒寫，但既有規則：沒有收件人不會推確認） */
export async function 有報價收件人(clientName: string, email = 'boss@example.com') {
  const client = await db.query.clients.findFirst({ where: (c, { eq }) => eq(c.name, clientName) })
  if (!client) throw new Error(`測試資料錯誤：找不到客戶 ${clientName}`)
  await db.insert(contacts).values({
    clientId: client.id,
    name: '窗口',
    email,
    receiveQuotes: true,
    isPrimary: true,
  })
}

const originalAdmin = env.LINE_ADMIN_USER_ID
const originalHeartbeat = env.HEARTBEAT_URL
afterEach(() => {
  env.LINE_ADMIN_USER_ID = originalAdmin
  env.HEARTBEAT_URL = originalHeartbeat
})

/** 對應規格的「系統設定為」：auto_send_enabled / line_admin_configured */
export async function 系統設定為(opts: { autoSend: boolean; lineAdmin: boolean; followupDays?: number }) {
  env.LINE_ADMIN_USER_ID = opts.lineAdmin ? originalAdmin || 'Uadmin000000000000000000000000000' : ''
  await updateSettings({
    autoSendEnabled: opts.autoSend,
    ...(opts.followupDays ? { quoteFollowupDays: opts.followupDays } : {}),
  })
}

export async function LINE本月推播額度已用完() {
  const config = await getSettings()
  await db
    .update(settings)
    .set({
      linePushCount: config.linePushMonthlyLimit,
      linePushResetAt: `${new Date().toISOString().slice(0, 7)}-01`,
    })
}

export function 心跳端點無法連線() {
  env.HEARTBEAT_URL = 'https://unreachable.heartbeat.invalid/ping'
}

/* ---------------------------- 專案 ---------------------------- */

type ProjectRow = {
  name: string
  client: string
  site?: string
  category: 'new_site' | 'custom_plugin' | 'bug_fix' | 'other'
  status?: 'not_started' | 'in_progress' | 'in_review' | 'completed'
  startDate?: string
  dueDate?: string
  handoverCompletedAt?: string
}

export async function 客戶id(name: string): Promise<string> {
  const c = await db.query.clients.findFirst({ where: (t, { eq }) => eq(t.name, name) })
  if (!c) throw new Error(`測試資料錯誤：找不到客戶 ${name}`)
  return c.id
}

export async function 網站id(name: string): Promise<string> {
  const s = await db.query.sites.findFirst({ where: (t, { eq }) => eq(t.name, name) })
  if (!s) throw new Error(`測試資料錯誤：找不到網站 ${name}`)
  return s.id
}

export async function 專案(name: string) {
  return db.query.projects.findFirst({ where: (t, { eq }) => eq(t.name, name) })
}

export async function 專案id(name: string): Promise<string> {
  const p = await 專案(name)
  if (!p) throw new Error(`測試資料錯誤：找不到專案 ${name}`)
  return p.id
}

export async function 有專案(row: ProjectRow) {
  const [p] = await db
    .insert(projects)
    .values({
      name: row.name,
      clientId: await 客戶id(row.client),
      siteId: row.site ? await 網站id(row.site) : null,
      category: row.category,
      status: row.status ?? 'not_started',
      startDate: row.startDate ?? null,
      dueDate: row.dueDate ?? null,
      handoverCompletedAt: row.handoverCompletedAt ? new Date(row.handoverCompletedAt) : null,
    })
    .returning()
  return p
}

export async function 有里程碑(projectName: string, name: string, dueOn: string, startOn?: string) {
  const [m] = await db
    .insert(projectMilestones)
    .values({ projectId: await 專案id(projectName), name, dueOn, startOn: startOn ?? null })
    .returning()
  return m
}

/** Google 日曆已授權（refresh token 加密存好）。假 Google 會發存取權杖 */
export async function 已授權Google日曆() {
  const box = encrypt('fake-refresh-token')
  await db.insert(oauthTokens).values({
    provider: 'google',
    accountEmail: 'owner@example.com',
    refreshTokenEncrypted: box.ciphertext,
    refreshTokenIv: box.iv,
    refreshTokenTag: box.tag,
  })
}

/* ---------------------------- 報價單 ---------------------------- */

type QuoteRow = {
  quote_no: string
  client: string
  site?: string
  project?: string
  status: 'draft' | 'pending_approval' | 'sent' | 'accepted' | 'rejected' | 'cancelled' | 'expired'
  sent_at?: string
  accepted_at?: string
  anchor_date?: string
  valid_until: string
  total: string
  paid_on?: string
}

/** 對應規格的「系統中有以下報價單」 */
export async function 有報價單(row: QuoteRow) {
  const [q] = await db
    .insert(quotes)
    .values({
      quoteNo: row.quote_no,
      clientId: await 客戶id(row.client),
      siteId: row.site ? await 網站id(row.site) : null,
      projectId: row.project ? await 專案id(row.project) : null,
      projectName: row.project ?? null,
      status: row.status,
      sentAt: row.sent_at ? new Date(row.sent_at) : null,
      acceptedAt: row.accepted_at ? new Date(row.accepted_at) : null,
      anchorDate: row.anchor_date ?? null,
      issueDate: '2026-11-01',
      validUntil: row.valid_until,
      total: row.total,
      subtotal: row.total,
      paidOn: row.paid_on ?? null,
      paidAmount: row.paid_on ? row.total : null,
    })
    .returning()
  await db.insert(quoteItems).values({ quoteId: q.id, description: '項目', unitPrice: row.total, amount: row.total })
  return q
}

export async function 報價單(quoteNo: string) {
  return db.query.quotes.findFirst({ where: (t, { eq }) => eq(t.quoteNo, quoteNo) })
}

/** 報價單包含服務項目：明細指向該項目，項目的 current_quote_id 指回報價單 */
export async function 報價單包含服務項目(quoteNo: string, identifier: string) {
  const q = await 報價單(quoteNo)
  const s = await db.query.services.findFirst({ where: (t, { eq }) => eq(t.identifier, identifier) })
  await db.insert(quoteItems).values({ quoteId: q!.id, serviceId: s!.id, description: identifier, unitPrice: s!.priceAmount ?? '0', amount: s!.priceAmount ?? '0' })
  await db.update(services).set({ currentQuoteId: q!.id, renewalState: 'drafted' }).where(eqCol(services.id, s!.id))
}

export async function 有通知紀錄(kind: 'quote_followup' | 'payment_followup', quoteNo: string, channel: 'line' | 'email', sentOn: string) {
  const q = await 報價單(quoteNo)
  await db.insert(notifications).values({ kind, quoteId: q!.id, channel, sentOn })
}

const originalResend = env.RESEND_API_KEY
afterEach(() => {
  env.RESEND_API_KEY = originalResend
})

/** mail_configured = false */
export function 寄信服務未設定() {
  env.RESEND_API_KEY = ''
}

/* ---------------------------- LINE 快速新增 ---------------------------- */

export async function LINE快速新增進度為(row: {
  step: 'choose_client' | 'choose_category' | 'input_name' | 'choose_due_date'
  client?: string
  category?: string
  name?: string
  updatedAt: string
}) {
  const updatedAt = new Date(row.updatedAt)
  await db.insert(lineConversations).values({
    lineUserId: env.LINE_ADMIN_USER_ID,
    step: row.step,
    data: {
      ...(row.client ? { clientId: await 客戶id(row.client) } : {}),
      ...(row.category ? { category: row.category } : {}),
      ...(row.name ? { name: row.name } : {}),
    },
    expiresAt: new Date(updatedAt.getTime() + 30 * 60_000),
    updatedAt,
  })
}

export async function LINE快速新增進度() {
  return db.query.lineConversations.findFirst({ where: (t, { eq }) => eq(t.lineUserId, env.LINE_ADMIN_USER_ID) })
}
