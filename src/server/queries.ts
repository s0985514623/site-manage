import { and, asc, count, desc, eq, isNotNull, sql } from 'drizzle-orm'

import { db } from '@/db'
import {
  clients,
  contacts,
  credentials,
  quotes,
  services,
  projects,
  sites,
} from '@/db/schema'

/**
 * 頁面用的查詢集中在這裡，而不是寫在各個 page.tsx 裡。
 * 這樣才能被 scripts/verify-queries.ts 直接執行驗證 ——
 * Drizzle 的查詢錯誤（欄位拼錯、join 條件錯）只會在執行時才炸，
 * 型別檢查抓不到。
 */

export async function listClients() {
  return db
    .select({
      id: clients.id,
      name: clients.name,
      taxId: clients.taxId,
      status: clients.status,
      siteCount: count(sql`distinct ${sites.id}`),
      serviceCount: count(sql`distinct ${services.id}`),
    })
    .from(clients)
    .leftJoin(sites, eq(sites.clientId, clients.id))
    .leftJoin(services, eq(services.siteId, sites.id))
    .groupBy(clients.id)
    .orderBy(asc(clients.name))
}

export async function getClientDetail(id: string) {
  const client = await db.query.clients.findFirst({ where: eq(clients.id, id) })
  if (!client) return null

  const [clientContacts, clientSites] = await Promise.all([
    db.query.contacts.findMany({
      where: eq(contacts.clientId, id),
      orderBy: [asc(contacts.name)],
    }),
    db.query.sites.findMany({
      where: eq(sites.clientId, id),
      orderBy: [asc(sites.name)],
      with: {
        services: {
          where: eq(services.status, 'active'),
          orderBy: [asc(services.expiresAt)],
        },
      },
    }),
  ])

  return { client, contacts: clientContacts, sites: clientSites }
}

export async function getSiteDetail(id: string) {
  return db.query.sites.findFirst({
    where: eq(sites.id, id),
    with: {
      client: true,
      services: {
        orderBy: [asc(services.expiresAt)],
        // 憑證的密文一起帶出來，但明文永遠只在按下「顯示」時才解密
        with: { credentials: { orderBy: [asc(credentials.label)] } },
      },
    },
  })
}

/** 到期總表：跨所有客戶的使用中服務項目，依到期日排序 */
export async function listActiveServices() {
  return db
    .select({
      id: services.id,
      type: services.type,
      identifier: services.identifier,
      provider: services.provider,
      expiresAt: services.expiresAt,
      isOurs: services.isOurs,
      priceAmount: services.priceAmount,
      currency: services.currency,
      renewalState: services.renewalState,
      currentQuoteId: services.currentQuoteId,
      detectedExpiresAt: services.detectedExpiresAt,
      siteId: sites.id,
      siteName: sites.name,
      clientId: clients.id,
      clientName: clients.name,
    })
    .from(services)
    .innerJoin(sites, eq(services.siteId, sites.id))
    .innerJoin(clients, eq(sites.clientId, clients.id))
    .where(eq(services.status, 'active'))
    .orderBy(asc(services.expiresAt))
}

export async function listQuotes() {
  return db
    .select({
      id: quotes.id,
      quoteNo: quotes.quoteNo,
      status: quotes.status,
      issueDate: quotes.issueDate,
      validUntil: quotes.validUntil,
      anchorDate: quotes.anchorDate,
      total: quotes.total,
      currency: quotes.currency,
      clientName: clients.name,
      siteName: sites.name,
      siteId: sites.id,
      projectId: quotes.projectId,
      projectName: projects.name,
    })
    .from(quotes)
    .innerJoin(clients, eq(quotes.clientId, clients.id))
    // left join：專案報價可以沒有網站，inner join 會讓它從列表消失（R1）
    .leftJoin(sites, eq(quotes.siteId, sites.id))
    .leftJoin(projects, eq(quotes.projectId, projects.id))
    .orderBy(desc(quotes.createdAt))
}

/**
 * 報價單收件人：勾選「接收報價單」且有填 Email 的聯絡人。
 *
 * 回傳空陣列代表這個客戶沒人收得到報價單 —— 呼叫端必須據此中止，
 * 而不是硬寄給主要聯絡人。寄給錯的人比晚寄更難收拾。
 */
export async function quoteRecipients(clientId: string): Promise<string[]> {
  const rows = await db
    .select({ email: contacts.email })
    .from(contacts)
    .where(
      and(
        eq(contacts.clientId, clientId),
        eq(contacts.receiveQuotes, true),
        isNotNull(contacts.email),
      ),
    )
  return rows.map((r) => r.email!).filter(Boolean)
}

export async function dashboardCounts() {
  const [[c], [s], [sv]] = await Promise.all([
    db.select({ n: count() }).from(clients),
    db.select({ n: count() }).from(sites),
    db.select({ n: count() }).from(services),
  ])
  return { clients: c.n, sites: s.n, services: sv.n }
}

export type ServiceRow = Awaited<ReturnType<typeof listActiveServices>>[number]
export type ClientRow = Awaited<ReturnType<typeof listClients>>[number]
export type QuoteRow = Awaited<ReturnType<typeof listQuotes>>[number]
