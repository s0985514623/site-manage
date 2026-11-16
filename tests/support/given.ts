import { afterEach } from 'vitest'

import { db } from '@/db'
import {
  clients,
  contacts,
  oauthTokens,
  projectMilestones,
  projects,
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

export async function 有里程碑(projectName: string, name: string, dueOn: string) {
  const [m] = await db
    .insert(projectMilestones)
    .values({ projectId: await 專案id(projectName), name, dueOn })
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
