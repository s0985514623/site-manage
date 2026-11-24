import { and, desc, eq, lt } from 'drizzle-orm'

import { db } from '@/db'
import { mailChecks, services, sites, type MailCheckItem } from '@/db/schema'
import { env } from '@/lib/env'
import { checkMail, mailboxOf, mailDomainOf, type MailCheckStatus } from '@/lib/mail-check'
import { fail, type ActionState } from '@/server/actions/helpers'

/** 檢查紀錄保留天數 */
const KEEP_DAYS = 30

export type MailCheckOutcome = {
  serviceId: string
  siteName: string
  clientName: string
  domain: string
  mailbox: string
  status: MailCheckStatus
  /** 上一次的結果；第一次檢查為 null */
  previous: MailCheckStatus | null
  results: MailCheckItem[]
}

/** EHLO 用本系統的主機名稱，對方伺服器才查得到反解 */
function heloName(): string {
  try {
    const host = new URL(env.APP_URL).hostname
    return host && host !== 'localhost' && host.includes('.') ? host : 'site-manager.invalid'
  } catch {
    return 'site-manager.invalid'
  }
}

type ServiceWithSite = typeof services.$inferSelect & {
  site: typeof sites.$inferSelect & { client: { name: string } }
}

async function checkOne(
  service: ServiceWithSite,
  opts: { save: boolean },
): Promise<MailCheckOutcome | { error: string }> {
  const domain = mailDomainOf(service, service.site)
  if (!domain) return { error: '沒有可檢查的網域' }
  const mailbox = mailboxOf(service, domain)

  const latest = await db.query.mailChecks.findFirst({
    where: eq(mailChecks.serviceId, service.id),
    orderBy: [desc(mailChecks.checkedAt)],
    columns: { status: true },
  })

  const { status, results } = await checkMail({
    domain,
    mailbox,
    dkimSelector: service.dkimSelector,
    helo: heloName(),
  })

  if (opts.save) {
    await db.insert(mailChecks).values({ serviceId: service.id, domain, mailbox, status, results })
  }

  return {
    serviceId: service.id,
    siteName: service.site.name,
    clientName: service.site.client.name,
    domain,
    mailbox,
    status,
    previous: latest?.status ?? null,
    results,
  }
}

/** 網站頁「立即檢查」 */
export async function checkMailService(serviceId: string): Promise<ActionState> {
  const service = await db.query.services.findFirst({
    where: eq(services.id, serviceId),
    with: { site: { with: { client: { columns: { name: true } } } } },
  })
  if (!service) return fail('NOT_FOUND', '找不到這個服務項目')
  if (service.type !== 'email') return fail('INVALID_ARGUMENT', '只有企業信箱項目可以檢查')

  const outcome = await checkOne(service, { save: true })
  if ('error' in outcome) {
    return fail('NO_MAIL_DOMAIN', '沒有可檢查的網域。請在服務項目填寫「偵測目標」，或在網站填寫網址')
  }
  return { ok: true }
}

/**
 * 排程：檢查所有使用中的企業信箱（網站已結案的略過）。
 * 乾跑只回報結果，不寫紀錄。
 */
export async function checkAllMailServices(opts: { save: boolean }) {
  const targets = await db.query.services.findMany({
    where: and(eq(services.type, 'email'), eq(services.status, 'active')),
    with: { site: { with: { client: { columns: { name: true } } } } },
  })

  const outcomes: MailCheckOutcome[] = []
  const skipped: { identifier: string; reason: string }[] = []
  // 網站已結案就不用再檢查
  for (const service of targets.filter((s) => s.site.status !== 'closed')) {
    const r = await checkOne(service, opts)
    if ('error' in r) skipped.push({ identifier: service.identifier, reason: r.error })
    else outcomes.push(r)
  }

  if (opts.save) {
    const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000)
    await db.delete(mailChecks).where(lt(mailChecks.checkedAt, cutoff))
  }

  return { outcomes, skipped }
}
