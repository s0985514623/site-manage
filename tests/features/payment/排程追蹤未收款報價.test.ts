import { beforeEach, describe, expect, it } from 'vitest'

import { fakeNet } from '../../fakes/network'
import { 排程執行 } from '../../support/cron'
import { 有報價單, 有客戶, 有專案, 有網站, 有通知紀錄, 系統設定為 } from '../../support/given'

const 續約報價 = (anchorDate: string, status: 'sent' | 'accepted' = 'accepted', paidOn?: string) =>
  有報價單({
    quote_no: '261101',
    client: '小森咖啡',
    site: '小森咖啡官網',
    status,
    sent_at: '2026-11-01T10:00:00+08:00',
    accepted_at: '2026-11-03T10:00:00+08:00',
    anchor_date: anchorDate,
    valid_until: '2026-11-15',
    total: '8400',
    paid_on: paidOn,
  })

const 專案報價 = (acceptedAt: string) =>
  有報價單({
    quote_no: '261020',
    client: '青禾設計',
    project: '會員集點外掛',
    status: 'accepted',
    sent_at: '2026-10-20T10:00:00+08:00',
    accepted_at: acceptedAt,
    valid_until: '2026-11-03',
    total: '52500',
  })

function 應推播收款追蹤(contains: string) {
  const texts = fakeNet.lineTexts()
  expect(texts).toHaveLength(1)
  expect(texts[0]).toContain('收款追蹤')
  expect(texts[0]).toContain(contains)
}

describe('排程追蹤未收款報價', () => {
  beforeEach(async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true })
    await 有客戶('小森咖啡')
    await 有客戶('青禾設計')
    await 有網站('小森咖啡官網', '小森咖啡')
    await 有專案({ name: '會員集點外掛', client: '青禾設計', category: 'custom_plugin', status: 'completed', startDate: '2026-10-01', dueDate: '2026-10-31' })
  })

  it.each([
    { status: 'sent' as const, paidOn: undefined },
    { status: 'accepted' as const, paidOn: '2026-11-10' },
  ])('非追蹤對象不提醒：$status / $paidOn', async ({ status, paidOn }) => {
    await 續約報價('2026-11-23', status, paidOn)
    await 排程執行('payment-followup')
    expect(fakeNet.calls('line')).toHaveLength(0)
  })

  it.each(['2026-11-23', '2026-11-20'])('續約報價到達提醒日時提醒：錨點 %s', async (anchor) => {
    await 續約報價(anchor)
    await 排程執行('payment-followup')
    應推播收款追蹤('261101')
  })

  it.each(['2026-11-24', '2026-11-21'])('續約報價未到提醒日時不提醒：錨點 %s', async (anchor) => {
    await 續約報價(anchor)
    await 排程執行('payment-followup')
    expect(fakeNet.calls('line')).toHaveLength(0)
  })

  it.each(['2026-11-02T10:00:00+08:00', '2026-10-30T10:00:00+08:00'])('專案報價到達提醒日時提醒：同意於 %s', async (acceptedAt) => {
    await 專案報價(acceptedAt)
    await 排程執行('payment-followup')
    應推播收款追蹤('261020')
  })

  it.each(['2026-11-03T10:00:00+08:00', '2026-10-31T10:00:00+08:00'])('專案報價未到提醒日時不提醒：同意於 %s', async (acceptedAt) => {
    await 專案報價(acceptedAt)
    await 排程執行('payment-followup')
    expect(fakeNet.calls('line')).toHaveLength(0)
  })

  it('今天已提醒過的報價單不再提醒', async () => {
    await 續約報價('2026-11-23')
    await 有通知紀錄('payment_followup', '261101', 'line', '2026-11-16')
    await 排程執行('payment-followup')
    expect(fakeNet.calls('line')).toHaveLength(0)
  })

  it('兩張需追蹤的報價單合併成一則訊息', async () => {
    await 續約報價('2026-11-23')
    await 專案報價('2026-11-02T10:00:00+08:00')
    await 排程執行('payment-followup')
    應推播收款追蹤('261101、261020')
  })

  it('排程成功後送出心跳', async () => {
    await 排程執行('payment-followup')
    const pings = fakeNet.calls('heartbeat')
    expect(pings.map((p) => new URL(p.url).searchParams.get('job'))).toEqual(['payment-followup'])
  })
})
