import { beforeEach, describe, expect, it } from 'vitest'

import { fakeNet } from '../../fakes/network'
import { 排程執行 } from '../../support/cron'
import { LINE本月推播額度已用完, 報價單, 有客戶, 有報價單, 有網站, 有通知紀錄, 系統設定為 } from '../../support/given'

type Status = 'sent' | 'accepted' | 'rejected' | 'cancelled'
const 小森報價 = (quoteNo: string, status: Status, sentAt: string, validUntil = '2026-12-31') =>
  有報價單({ quote_no: quoteNo, client: '小森咖啡', site: '小森咖啡官網', status, sent_at: sentAt, anchor_date: '2026-12-20', valid_until: validUntil, total: '8400' })

describe('排程追蹤未回覆報價', () => {
  beforeEach(async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true, followupDays: 7 })
    await 有客戶('小森咖啡')
    await 有客戶('青禾設計')
    await 有網站('小森咖啡官網', '小森咖啡')
    await 有網站('青禾官網', '青禾設計')
  })

  it.each(['accepted', 'rejected', 'cancelled'] as const)('非已寄出狀態的報價單不提醒：%s', async (status) => {
    await 小森報價('261101', status, '2026-11-01T10:00:00+08:00', '2026-11-15')
    await 排程執行('quote-followup')
    expect(fakeNet.calls('line')).toHaveLength(0)
  })

  it.each(['2026-11-09T10:00:00+08:00', '2026-11-02T10:00:00+08:00'])('寄出天數為 N 的倍數時提醒：%s', async (sentAt) => {
    await 小森報價('261101', 'sent', sentAt)
    await 排程執行('quote-followup')
    const texts = fakeNet.lineTexts()
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('報價追蹤')
    expect(texts[0]).toContain('261101')
  })

  it.each(['2026-11-10T10:00:00+08:00', '2026-11-03T10:00:00+08:00'])('寄出天數不是 N 的倍數時不提醒：%s', async (sentAt) => {
    await 小森報價('261101', 'sent', sentAt)
    await 排程執行('quote-followup')
    expect(fakeNet.calls('line')).toHaveLength(0)
  })

  it('追蹤天數調整為 3 天時第 3 天提醒', async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true, followupDays: 3 })
    await 小森報價('261113', 'sent', '2026-11-13T10:00:00+08:00', '2026-11-27')
    await 排程執行('quote-followup')
    expect(fakeNet.lineTexts()[0]).toContain('261113')
  })

  it('今天已提醒過的報價單不再提醒', async () => {
    await 小森報價('261109', 'sent', '2026-11-09T10:00:00+08:00', '2026-11-23')
    await 有通知紀錄('quote_followup', '261109', 'line', '2026-11-16')
    await 排程執行('quote-followup')
    expect(fakeNet.calls('line')).toHaveLength(0)
  })

  it('兩張需追蹤的報價單合併成一則訊息', async () => {
    await 小森報價('261109', 'sent', '2026-11-09T10:00:00+08:00', '2026-11-23')
    await 有報價單({ quote_no: '261102', client: '青禾設計', site: '青禾官網', status: 'sent', sent_at: '2026-11-02T10:00:00+08:00', anchor_date: '2026-12-10', valid_until: '2026-11-16', total: '3600' })
    await 排程執行('quote-followup')
    const texts = fakeNet.lineTexts()
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('報價追蹤')
    expect(texts[0]).toContain('261109、261102')
  })

  it('已過有效期的報價單仍為已寄出並標示', async () => {
    await 小森報價('261102', 'sent', '2026-11-02T10:00:00+08:00', '2026-11-15')
    await 排程執行('quote-followup')
    expect(fakeNet.lineTexts()[0]).toContain('261102（已過有效期）')
    expect((await 報價單('261102'))?.status).toBe('sent')
  })

  it('推播額度用完時追蹤提醒改寄 Email', async () => {
    await 小森報價('261109', 'sent', '2026-11-09T10:00:00+08:00', '2026-11-23')
    await LINE本月推播額度已用完()
    await 排程執行('quote-followup')
    expect(fakeNet.calls('line')).toHaveLength(0)
    const mails = fakeNet.mails()
    expect(mails).toHaveLength(1)
    expect(mails[0].to).toEqual(['owner@example.com'])
    expect(mails[0].subject).toContain('報價追蹤')
  })

  it('排程成功後送出心跳', async () => {
    await 排程執行('quote-followup')
    const pings = fakeNet.calls('heartbeat')
    expect(pings.map((p) => new URL(p.url).searchParams.get('job'))).toEqual(['quote-followup'])
  })

  it('同一天重跑排程不會重複推播', async () => {
    await 小森報價('261109', 'sent', '2026-11-09T10:00:00+08:00', '2026-11-23')
    await 排程執行('quote-followup')
    await 排程執行('quote-followup')
    expect(fakeNet.calls('line')).toHaveLength(1)
  })
})
