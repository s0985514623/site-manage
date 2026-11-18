import { randomUUID } from 'node:crypto'

import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/db'
import { quotePdfFilename } from '@/lib/pdf/render'
import { updateSettings } from '@/lib/settings'
import { createRenewalQuote } from '@/server/quotes/renewal'

import { fakeNet } from '../../fakes/network'
import { 有客戶, 有服務項目, 有網站, 系統設定為, 網站id } from '../../support/given'

const OWNER = 'owner@example.com'

async function 管理者為網站開立續約報價單(site: string) {
  return createRenewalQuote(await 網站id(site), OWNER)
}

async function 網站的報價單(site: string) {
  const id = await 網站id(site)
  return db.query.quotes.findMany({
    where: (q, { eq }) => eq(q.siteId, id),
    with: { items: true },
  })
}

async function 服務項目(identifier: string) {
  return db.query.services.findFirst({ where: (s, { eq }) => eq(s.identifier, identifier) })
}

describe('管理者手動開立續約報價單', () => {
  beforeEach(async () => {
    await 系統設定為({ autoSend: true, lineAdmin: true })
    await updateSettings({ quoteTriggerDays: 45, quoteWindowDays: 60 })
    await 有客戶('小森咖啡')
    await 有網站('小森咖啡官網', '小森咖啡')
  })

  it('網站不存在時操作失敗', async () => {
    const r = await createRenewalQuote(randomUUID(), OWNER)
    expect(r.violationType).toBe('NOT_FOUND')
  })

  it('沒有可續約項目時操作失敗', async () => {
    await 有服務項目('小森咖啡官網', {
      type: 'domain',
      identifier: 'morimori.com.tw',
      expiresAt: '2026-12-20',
      priceAmount: '1200',
      isOurs: false,
    })
    const r = await 管理者為網站開立續約報價單('小森咖啡官網')
    expect(r.violationType).toBe('NO_RENEWABLE_SERVICE')
  })

  it('項目都沒設售價時操作失敗', async () => {
    await 有服務項目('小森咖啡官網', {
      type: 'domain',
      identifier: 'morimori.com.tw',
      expiresAt: '2026-12-20',
      priceAmount: null,
      isOurs: true,
    })
    const r = await 管理者為網站開立續約報價單('小森咖啡官網')
    expect(r.violationType).toBe('NO_RENEWABLE_SERVICE')
  })

  it('已被報價單涵蓋的項目不會重複開單', async () => {
    await 有服務項目('小森咖啡官網', {
      type: 'domain',
      identifier: 'morimori.com.tw',
      expiresAt: '2026-12-20',
      priceAmount: '1200',
      isOurs: true,
    })
    expect((await 管理者為網站開立續約報價單('小森咖啡官網')).ok).toBe(true)

    const r = await 管理者為網站開立續約報價單('小森咖啡官網')
    expect(r.violationType).toBe('NO_RENEWABLE_SERVICE')
    expect(await 網站的報價單('小森咖啡官網')).toHaveLength(1)
  })

  it('同時按兩次只會開出一張', async () => {
    await 有服務項目('小森咖啡官網', {
      type: 'domain',
      identifier: 'morimori.com.tw',
      expiresAt: '2026-12-20',
      priceAmount: '1200',
      isOurs: true,
    })
    const results = await Promise.all([
      管理者為網站開立續約報價單('小森咖啡官網'),
      管理者為網站開立續約報價單('小森咖啡官網'),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.find((r) => !r.ok)?.violationType).toBe('NO_RENEWABLE_SERVICE')
    expect(await 網站的報價單('小森咖啡官網')).toHaveLength(1)
  })

  it('混合幣別時操作失敗', async () => {
    await 有服務項目('小森咖啡官網', {
      type: 'domain',
      identifier: 'morimori.com.tw',
      expiresAt: '2026-12-20',
      priceAmount: '1200',
      currency: 'TWD',
      isOurs: true,
    })
    await 有服務項目('小森咖啡官網', {
      type: 'hosting',
      identifier: '雲端主機',
      expiresAt: '2026-12-31',
      priceAmount: '100',
      currency: 'USD',
      isOurs: true,
    })
    const r = await 管理者為網站開立續約報價單('小森咖啡官網')
    expect(r.violationType).toBe('MIXED_CURRENCY')
  })

  it('尚未到觸發天數也能開立', async () => {
    await 有服務項目('小森咖啡官網', {
      type: 'domain',
      identifier: 'morimori.com.tw',
      expiresAt: '2027-03-01',
      priceAmount: '1200',
      isOurs: true,
    })
    const r = await 管理者為網站開立續約報價單('小森咖啡官網')
    expect(r.ok).toBe(true)
    const quotes = await 網站的報價單('小森咖啡官網')
    expect(quotes).toHaveLength(1)
    expect(quotes[0].status).toBe('draft')
    expect(quotes[0].projectName).toBe('小森咖啡官網續約')
    expect(
      quotePdfFilename({ ...quotes[0], client: { name: '小森咖啡' }, site: { name: '小森咖啡官網' } }),
    ).toBe(`小森咖啡官網續約報價單v${quotes[0].quoteNo}.pdf`)
  })

  it('視窗內的項目合併、視窗外的不納入', async () => {
    await 有服務項目('小森咖啡官網', {
      type: 'domain',
      identifier: 'morimori.com.tw',
      expiresAt: '2026-12-20',
      priceAmount: '1200',
      isOurs: true,
    })
    await 有服務項目('小森咖啡官網', {
      type: 'hosting',
      identifier: '雲端主機',
      expiresAt: '2027-01-31',
      priceAmount: '6000',
      isOurs: true,
    })
    await 有服務項目('小森咖啡官網', {
      type: 'maintenance',
      identifier: '年度維護',
      expiresAt: '2027-06-30',
      priceAmount: '12000',
      isOurs: true,
    })
    const r = await 管理者為網站開立續約報價單('小森咖啡官網')
    expect(r.ok).toBe(true)

    const [quote] = await 網站的報價單('小森咖啡官網')
    const covered = await Promise.all(
      quote.items.map((i) => db.query.services.findFirst({ where: (s, { eq }) => eq(s.id, i.serviceId!) })),
    )
    expect(covered.map((s) => s!.identifier).sort()).toEqual(['morimori.com.tw', '雲端主機'].sort())
    expect((await 服務項目('年度維護'))!.renewalState).toBe('upcoming')
  })

  it('自動寄模式下手動開立也不推 LINE', async () => {
    await 有服務項目('小森咖啡官網', {
      type: 'domain',
      identifier: 'morimori.com.tw',
      expiresAt: '2026-12-20',
      priceAmount: '1200',
      isOurs: true,
    })
    await 管理者為網站開立續約報價單('小森咖啡官網')

    const quotes = await 網站的報價單('小森咖啡官網')
    expect(quotes).toHaveLength(1)
    expect(quotes[0].status).toBe('draft')
    expect((await 服務項目('morimori.com.tw'))!.renewalState).toBe('drafted')
    expect(fakeNet.calls('line')).toHaveLength(0)
  })
})
