import { afterEach } from 'vitest'

import { db } from '@/db'
import {
  clients,
  contacts,
  services,
  settings,
  sites,
  type NewService,
} from '@/db/schema'
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
