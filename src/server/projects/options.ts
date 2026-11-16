import { asc, eq } from 'drizzle-orm'

import { db } from '@/db'
import { clients, sites } from '@/db/schema'

/** 專案表單的下拉選項：啟用中的客戶與其網站 */
export async function projectFormOptions() {
  const [clientRows, siteRows] = await Promise.all([
    db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(eq(clients.status, 'active'))
      .orderBy(asc(clients.name)),
    db
      .select({
        id: sites.id,
        name: sites.name,
        clientId: sites.clientId,
        clientName: clients.name,
      })
      .from(sites)
      .innerJoin(clients, eq(sites.clientId, clients.id))
      .where(eq(clients.status, 'active'))
      .orderBy(asc(clients.name), asc(sites.name)),
  ])
  return { clients: clientRows, sites: siteRows }
}
