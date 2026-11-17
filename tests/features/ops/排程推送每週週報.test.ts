import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/db'
import { notifications } from '@/db/schema'

import { fakeNet } from '../../fakes/network'
import { 排程執行 } from '../../support/cron'
import { LINE本月推播額度已用完, 有報價單, 有客戶, 有專案, 有服務項目, 有網站, 有里程碑, 系統設定為 } from '../../support/given'

const pings = () => fakeNet.calls('heartbeat').map((p) => new URL(p.url).searchParams.get('job'))

describe('排程推送每週週報', () => {
  beforeEach(async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true })
    await 有客戶('小森咖啡')
    await 有客戶('青禾設計')
    await 有網站('小森咖啡官網', '小森咖啡')
  })

  it('週報彙整本週三類待辦', async () => {
    await 有服務項目('小森咖啡官網', { type: 'domain', identifier: 'morimori.com.tw', expiresAt: '2026-11-20', priceAmount: '1200' })
    await 有服務項目('小森咖啡官網', { type: 'hosting', identifier: '基本方案', expiresAt: '2026-11-24', priceAmount: '6000' })
    await 有報價單({ quote_no: '261109', client: '小森咖啡', site: '小森咖啡官網', status: 'sent', sent_at: '2026-11-09T10:00:00+08:00', anchor_date: '2026-12-20', valid_until: '2026-11-23', total: '8400' })
    await 有專案({ name: '青禾新官網', client: '青禾設計', category: 'new_site', status: 'in_progress', startDate: '2026-11-01', dueDate: '2026-11-21' })
    await 有里程碑('青禾新官網', '設計稿確認', '2026-11-18')

    await 排程執行('weekly-report')

    const texts = fakeNet.lineTexts()
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('週報')
    expect(texts[0]).toContain('本週到期：morimori.com.tw 11/20')
    expect(texts[0]).toContain('未回覆報價：261109')
    expect(texts[0]).toContain('專案截止：青禾新官網 11/21')
    expect(texts[0]).toContain('里程碑：設計稿確認 11/18')
    expect(texts[0]).not.toContain('基本方案')
  })

  it('本週進行中的時程列入週報', async () => {
    await 有專案({ name: '青禾新官網', client: '青禾設計', category: 'new_site', status: 'in_progress', startDate: '2026-11-01', dueDate: '2026-12-31' })
    await 有里程碑('青禾新官網', '前端開發', '2026-12-10', '2026-11-10')
    await 有里程碑('青禾新官網', '上線準備', '2026-12-20', '2026-12-15')
    await 排程執行('weekly-report')
    const text = fakeNet.lineTexts()[0]
    expect(text).toContain('時程：前端開發 11/10–12/10')
    expect(text).not.toContain('上線準備')
  })

  it('沒有待辦時推送本週無待辦', async () => {
    await 排程執行('weekly-report')
    expect(fakeNet.lineTexts()[0]).toContain('本週無待辦')
  })

  it('推播額度用完時週報改寄 Email', async () => {
    await LINE本月推播額度已用完()
    await 排程執行('weekly-report')
    expect(fakeNet.calls('line')).toHaveLength(0)
    const mails = fakeNet.mails()
    expect(mails[0].to).toEqual(['owner@example.com'])
    expect(mails[0].subject).toContain('每週週報')
  })

  it('週報推送後送出心跳', async () => {
    await 排程執行('weekly-report')
    expect(pings()).toEqual(['weekly-report'])
  })

  it('同一天重跑週報不重複推送', async () => {
    await db.insert(notifications).values({ kind: 'weekly_report', channel: 'line', sentOn: '2026-11-16' })
    await 排程執行('weekly-report')
    expect(fakeNet.calls('line')).toHaveLength(0)
    expect(pings()).toEqual(['weekly-report'])
  })
})
