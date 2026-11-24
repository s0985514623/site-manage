import { desc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/db'
import { mailChecks, services, sites, type MailCheckItem } from '@/db/schema'
import { mailNet, type SmtpProbeResult } from '@/lib/mail-check'
import { checkMailbox } from '@/server/actions/mail-check'

import { fakeNet } from '../../fakes/network'
import { 今天是 } from '../../support/clock'
import { 排程執行 } from '../../support/cron'
import { 有客戶, 有服務項目, 系統設定為 } from '../../support/given'

/* ---------------- 假 DNS 與 SMTP ---------------- */

const original = { ...mailNet }
const notFound = () => Object.assign(new Error('not found'), { code: 'ENOTFOUND' })

let mx: Record<string, { exchange: string; priority: number }[]>
let txt: Record<string, string[]>
let smtp: (host: string, rcpt: string) => SmtpProbeResult
const rcpts: string[] = []

function 網域DNS與收信伺服器都正常(domain: string) {
  mx[domain] = [{ exchange: `mx.${domain}`, priority: 10 }]
  txt[domain] = ['v=spf1 include:_spf.google.com ~all']
  txt[`google._domainkey.${domain}`] = ['v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4']
  txt[`_dmarc.${domain}`] = ['v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com']
}

const 收信伺服器回 = (code: number, message: string): typeof smtp => () => ({
  connected: true,
  stage: 'rcpt',
  code,
  message,
  starttls: true,
})

beforeEach(() => {
  mx = {}
  txt = {}
  rcpts.length = 0
  smtp = 收信伺服器回(250, '2.1.5 OK')
  mailNet.resolveMx = async (d) => {
    if (!mx[d]) throw notFound()
    return mx[d]
  }
  mailNet.resolveTxt = async (n) => {
    if (!txt[n]) throw notFound()
    return txt[n].map((r) => [r])
  }
  mailNet.smtpProbe = async (host, rcpt) => {
    rcpts.push(rcpt)
    return smtp(host, rcpt)
  }
})

afterEach(() => {
  Object.assign(mailNet, original)
})

/* ---------------- Given / Then ---------------- */

async function 背景() {
  今天是('2026-11-24')
  const client = await 有客戶('冠澄')
  await db.insert(sites).values({ name: '官網', clientId: client.id, primaryUrl: 'https://www.acme.com.tw' })
  網域DNS與收信伺服器都正常('acme.com.tw')
}

const 企業信箱 = (siteName: string, identifier: string, values: Partial<typeof services.$inferInsert> = {}) =>
  有服務項目(siteName, { type: 'email', identifier, expiresAt: '2027-06-30', ...values })

async function 上次檢查為(serviceId: string, status: 'ok' | 'fail') {
  await db.insert(mailChecks).values({
    serviceId,
    checkedAt: new Date('2026-11-23T08:30:00+08:00'),
    domain: 'acme.com.tw',
    mailbox: 'service@acme.com.tw',
    status,
    results: [],
  })
}

async function 檢查(serviceId: string) {
  const form = new FormData()
  form.set('id', serviceId)
  form.set('siteId', 'x')
  return checkMailbox({}, form)
}

async function 最新檢查結果(serviceId: string) {
  const row = await db.query.mailChecks.findFirst({
    where: eq(mailChecks.serviceId, serviceId),
    orderBy: [desc(mailChecks.checkedAt)],
  })
  if (!row) throw new Error('沒有檢查紀錄')
  return row
}

const 項目狀態 = (results: MailCheckItem[], key: MailCheckItem['key']) => results.find((r) => r.key === key)?.status

/* ---------------- 規格 ---------------- */

describe('檢查企業信箱', () => {
  beforeEach(背景)

  it('不是企業信箱的項目不能檢查', async () => {
    const hosting = await 有服務項目('官網', { type: 'hosting', identifier: '基本方案', expiresAt: '2027-06-30' })
    const r = await 檢查(hosting.id)
    expect(r.violationType).toBe('INVALID_ARGUMENT')
  })

  it('找不到網域時檢查失敗', async () => {
    await db.update(sites).set({ primaryUrl: null }).where(eq(sites.name, '官網'))
    const service = await 企業信箱('官網', '企業信箱')
    const r = await 檢查(service.id)
    expect(r.violationType).toBe('NO_MAIL_DOMAIN')
    expect(await db.query.mailChecks.findMany()).toHaveLength(0)
  })

  it('預設檢查 service@網站網域', async () => {
    const service = await 企業信箱('官網', '企業信箱')
    const r = await 檢查(service.id)
    expect(r.ok).toBe(true)
    const row = await 最新檢查結果(service.id)
    expect(row).toMatchObject({ domain: 'acme.com.tw', mailbox: 'service@acme.com.tw', status: 'ok' })
    expect(row.results.map((i) => i.key)).toEqual(['mx', 'smtp', 'spf', 'dkim', 'dmarc'])
  })

  it('填了檢查信箱就改檢查該信箱', async () => {
    const service = await 企業信箱('官網', '企業信箱', { mailbox: 'info@acme.com.tw' })
    await 檢查(service.id)
    expect(rcpts).toEqual(['info@acme.com.tw'])
  })

  it('沒有 SPF 判定異常', async () => {
    delete txt['acme.com.tw']
    const service = await 企業信箱('官網', '企業信箱')
    await 檢查(service.id)
    const row = await 最新檢查結果(service.id)
    expect(row.status).toBe('fail')
    expect(項目狀態(row.results, 'spf')).toBe('fail')
  })

  it('收信伺服器拒收信箱判定異常', async () => {
    smtp = 收信伺服器回(550, '5.1.1 User unknown')
    const service = await 企業信箱('官網', '企業信箱')
    await 檢查(service.id)
    const row = await 最新檢查結果(service.id)
    expect(row.status).toBe('fail')
    expect(項目狀態(row.results, 'smtp')).toBe('fail')
  })

  it('連不上 25 port 只標示注意', async () => {
    smtp = () => ({ connected: false, error: 'timeout', message: '連線逾時（15 秒）' })
    const service = await 企業信箱('官網', '企業信箱')
    await 檢查(service.id)
    const row = await 最新檢查結果(service.id)
    expect(row.status).toBe('warn')
    expect(項目狀態(row.results, 'smtp')).toBe('warn')
  })

  it('指定的 DKIM selector 查不到判定異常', async () => {
    const service = await 企業信箱('官網', '企業信箱', { dkimSelector: 'custom' })
    await 檢查(service.id)
    const row = await 最新檢查結果(service.id)
    expect(row.status).toBe('fail')
    expect(項目狀態(row.results, 'dkim')).toBe('fail')
  })

  it('信箱由正常變成異常時用 LINE 與 Email 告警', async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true })
    const service = await 企業信箱('官網', '企業信箱')
    await 上次檢查為(service.id, 'ok')
    delete mx['acme.com.tw']

    const r = await 排程執行('mail-check')
    expect(r.status).toBe(200)
    expect(fakeNet.lineTexts().join('\n')).toContain('信箱異常')
    expect(fakeNet.mails().map((m) => m.subject)).toContain('[信箱檢查] 1 個信箱異常')
  })

  it('持續異常不重複告警', async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true })
    const service = await 企業信箱('官網', '企業信箱')
    await 上次檢查為(service.id, 'fail')
    delete mx['acme.com.tw']

    await 排程執行('mail-check')
    expect(fakeNet.lineTexts()).toHaveLength(0)
    expect((await 最新檢查結果(service.id)).status).toBe('fail')
  })

  it('從異常恢復時通知', async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true })
    const service = await 企業信箱('官網', '企業信箱')
    await 上次檢查為(service.id, 'fail')

    await 排程執行('mail-check')
    expect(fakeNet.lineTexts().join('\n')).toContain('已恢復')
  })

  it('已結案網站與已終止的信箱不檢查', async () => {
    await 企業信箱('官網', '企業信箱', { status: 'cancelled' })
    const client = await db.query.clients.findFirst()
    await db.insert(sites).values({ name: '舊站', clientId: client!.id, primaryUrl: 'https://old.example.com', status: 'closed' })
    await 企業信箱('舊站', '舊信箱')

    const r = await 排程執行('mail-check')
    expect(r.body.checked).toBe(0)
    expect(rcpts).toHaveLength(0)
  })
})
