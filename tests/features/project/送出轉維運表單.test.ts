import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/db'
import { submitHandover, type HandoverItemInput } from '@/server/projects/handover'

import { fakeGoogleCalendar } from '../../fakes/google-calendar'
import { 客戶id, 專案, 專案id, 已授權Google日曆, 有客戶, 有專案, 有網站 } from '../../support/given'

const OWNER = 'owner@example.com'
const domain: HandoverItemInput = {
  type: 'domain',
  identifier: 'qinghe.design',
  expiresAt: '2027-11-16',
  priceAmount: '1200',
  billingCycle: 'yearly',
}
const hosting: HandoverItemInput = {
  type: 'hosting',
  identifier: '基本方案',
  expiresAt: '2027-11-16',
  priceAmount: '6000',
  billingCycle: 'yearly',
}

async function 管理者送出轉維運表單(project: string, items: HandoverItemInput[]) {
  return submitHandover(await 專案id(project), { items }, OWNER)
}

async function 網站(name: string) {
  return db.query.sites.findFirst({ where: (t, { eq }) => eq(t.name, name) })
}

describe('送出轉維運表單', () => {
  beforeEach(async () => {
    await 有客戶('青禾設計')
    await 有網站('青禾舊站', '青禾設計', 'building')
    await 已授權Google日曆()
  })

  it.each([
    { name: '會員集點外掛', category: 'custom_plugin' as const, status: 'completed' as const, handover: undefined },
    { name: '青禾新官網', category: 'new_site' as const, status: 'in_progress' as const, handover: undefined },
    { name: '青禾新官網', category: 'new_site' as const, status: 'completed' as const, handover: '2026-11-10T10:00:00+08:00' },
  ])('不符合轉維運條件時操作失敗：$category / $status', async ({ name, category, status, handover }) => {
    await 有專案({ name, client: '青禾設計', category, status, startDate: '2026-11-01', dueDate: '2026-12-31', handoverCompletedAt: handover })
    const r = await 管理者送出轉維運表單(name, [domain])
    expect(r.violationType).toBe('HANDOVER_NOT_ALLOWED')
  })

  describe('已完成的新網站專案', () => {
    beforeEach(async () => {
      await 有專案({ name: '青禾新官網', client: '青禾設計', category: 'new_site', status: 'completed', startDate: '2026-11-01', dueDate: '2026-12-31' })
    })

    it.each([
      { type: 'website', identifier: 'qinghe.design', expiresAt: '2027-11-16', priceAmount: '1200' },
      { type: 'domain', identifier: '', expiresAt: '2027-11-16', priceAmount: '1200' },
      { type: 'domain', identifier: 'qinghe.design', expiresAt: '', priceAmount: '1200' },
      { type: 'domain', identifier: 'qinghe.design', expiresAt: '2027-11-16', priceAmount: '' },
      { type: 'domain', identifier: 'qinghe.design', expiresAt: '2027-11-16', priceAmount: '-1' },
    ])('服務項目資料不合法時操作失敗：%o', async (item) => {
      const r = await 管理者送出轉維運表單('青禾新官網', [{ ...item, billingCycle: 'yearly' }])
      expect(r.violationType).toBe('INVALID_ARGUMENT')
      // 失敗時不會被標記為已轉維運
      expect((await 專案('青禾新官網'))?.handoverCompletedAt).toBeNull()
    })

    it('沒有勾選任何服務項目時操作失敗', async () => {
      const r = await 管理者送出轉維運表單('青禾新官網', [])
      expect(r.violationType).toBe('INVALID_ARGUMENT')
    })

    it('未綁網站的專案轉維運時建立新網站', async () => {
      const r = await 管理者送出轉維運表單('青禾新官網', [domain, hosting])
      expect(r.ok).toBe(true)
      const site = await 網站('青禾新官網')
      expect(site).toMatchObject({ clientId: await 客戶id('青禾設計'), status: 'live' })
      const p = await 專案('青禾新官網')
      expect(p?.siteId).toBe(site!.id)
      expect(p?.handoverCompletedAt?.toISOString()).toBe(new Date('2026-11-16T10:00:00+08:00').toISOString())
    })

    it('轉維運建立的服務項目與表單一致', async () => {
      await 管理者送出轉維運表單('青禾新官網', [domain, hosting])
      const site = await 網站('青禾新官網')
      const rows = await db.query.services.findMany({
        where: (t, { eq }) => eq(t.siteId, site!.id),
        orderBy: (t, { asc }) => [asc(t.type)],
      })
      const projectId = await 專案id('青禾新官網')
      expect(
        rows.map((s) => ({
          type: s.type,
          identifier: s.identifier,
          expires_at: s.expiresAt,
          price_amount: Number(s.priceAmount),
          billing_cycle: s.billingCycle,
          status: s.status,
          renewal_state: s.renewalState,
          source_project: s.sourceProjectId,
        })),
      ).toEqual([
        { type: 'domain', identifier: 'qinghe.design', expires_at: '2027-11-16', price_amount: 1200, billing_cycle: 'yearly', status: 'active', renewal_state: 'upcoming', source_project: projectId },
        { type: 'hosting', identifier: '基本方案', expires_at: '2027-11-16', price_amount: 6000, billing_cycle: 'yearly', status: 'active', renewal_state: 'upcoming', source_project: projectId },
      ])
      expect(fakeGoogleCalendar.events('網站到期管理')).toHaveLength(2)
    })

    it('重複送出只轉維運一次', async () => {
      await 管理者送出轉維運表單('青禾新官網', [domain])
      const again = await 管理者送出轉維運表單('青禾新官網', [domain])
      expect(again.violationType).toBe('HANDOVER_NOT_ALLOWED')
      expect(await db.query.services.findMany()).toHaveLength(1)
    })
  })

  it('已綁建置中網站的專案轉維運後網站上線', async () => {
    await 有專案({ name: '青禾改版', client: '青禾設計', site: '青禾舊站', category: 'new_site', status: 'completed', startDate: '2026-11-01', dueDate: '2026-12-31' })
    const r = await 管理者送出轉維運表單('青禾改版', [domain])
    expect(r.ok).toBe(true)
    expect((await 網站('青禾舊站'))?.status).toBe('live')
    expect(await db.query.sites.findMany()).toHaveLength(1)
  })
})
