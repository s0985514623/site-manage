import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/db'
import { settings } from '@/db/schema'
import { getSettings } from '@/lib/settings'

import { fakeNet } from '../../fakes/network'
import { 有報價單, 有客戶, 有專案, 有服務項目, 有網站, 系統設定為 } from '../../support/given'
import { LINE事件, 傳送, 非管理者 } from '../../support/line'

const 回覆 = () => fakeNet.lineTexts().join('\n')

describe('透過LINE查詢資訊', () => {
  beforeEach(async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true })
    await 有客戶('小森咖啡')
    await 有客戶('青禾設計')
    await 有網站('小森咖啡官網', '小森咖啡')
  })

  it('非管理者查詢時回覆無權限', async () => {
    await LINE事件([傳送('postback', 'query=expiring', 非管理者)])
    expect(回覆()).toContain('這個帳號沒有操作權限')
  })

  it('簽章不正確的請求被拒絕', async () => {
    const { POST } = await import('@/app/api/line/webhook/route')
    const response = await POST(
      new Request('https://site.test/api/line/webhook', {
        method: 'POST',
        headers: { 'x-line-signature': 'forged' },
        body: JSON.stringify({ events: [傳送('postback', 'query=expiring')] }),
      }),
    )
    expect(response.status).toBe(401)
  })

  it('查詢近期到期項目', async () => {
    await 有服務項目('小森咖啡官網', { type: 'domain', identifier: 'morimori.com.tw', expiresAt: '2026-11-30', priceAmount: '1200' })
    await 有服務項目('小森咖啡官網', { type: 'hosting', identifier: '基本方案', expiresAt: '2027-06-30', priceAmount: '6000' })
    await LINE事件([傳送('postback', 'query=expiring')])
    expect(回覆()).toContain('morimori.com.tw 2026-11-30（14 天）')
    expect(回覆()).not.toContain('基本方案')
  })

  it('查詢待處理報價', async () => {
    const base = { client: '小森咖啡', site: '小森咖啡官網', total: '8400' }
    await 有報價單({ ...base, quote_no: '261110', status: 'pending_approval', anchor_date: '2026-12-20', valid_until: '2026-11-24' })
    await 有報價單({ ...base, quote_no: '261109', status: 'sent', sent_at: '2026-11-09T10:00:00+08:00', anchor_date: '2026-12-20', valid_until: '2026-11-23' })
    await 有報價單({ ...base, quote_no: '261101', status: 'accepted', sent_at: '2026-11-01T10:00:00+08:00', accepted_at: '2026-11-03T10:00:00+08:00', anchor_date: '2026-11-23', valid_until: '2026-11-15' })
    await 有報價單({ ...base, quote_no: '261001', status: 'accepted', sent_at: '2026-10-01T10:00:00+08:00', accepted_at: '2026-10-03T10:00:00+08:00', anchor_date: '2026-10-23', valid_until: '2026-10-15', paid_on: '2026-10-10' })
    await LINE事件([傳送('postback', 'query=quotes')])
    expect(回覆()).toContain('待確認：261110；未回覆：261109；未收款：261101')
    expect(回覆()).not.toContain('261001')
  })

  it('查詢進行中專案', async () => {
    await 有專案({ name: '青禾新官網', client: '青禾設計', category: 'new_site', status: 'in_progress', startDate: '2026-11-01', dueDate: '2026-12-31' })
    await 有專案({ name: '結帳頁修正', client: '小森咖啡', category: 'bug_fix', status: 'completed', startDate: '2026-10-20', dueDate: '2026-10-25' })
    await LINE事件([傳送('postback', 'query=projects')])
    expect(回覆()).toContain('青禾新官網（進行中，12/31 截止）')
    expect(回覆()).not.toContain('結帳頁修正')
  })

  it('進行中專案超過 5 筆時只列 5 筆並附連結', async () => {
    for (let i = 1; i <= 6; i++) {
      await 有專案({ name: `專案${i}`, client: '青禾設計', category: 'other', status: 'in_progress', dueDate: `2026-12-0${i}` })
    }
    await LINE事件([傳送('postback', 'query=projects')])
    const text = 回覆()
    expect(text.match(/^· /gm)).toHaveLength(5)
    expect(text).not.toContain('專案6')
    expect(text).toContain('還有 1 筆，查看全部')
  })

  it('查詢回覆不增加推播計數', async () => {
    await getSettings()
    await db.update(settings).set({ linePushCount: 10, linePushResetAt: '2026-11-01' })
    await LINE事件([傳送('postback', 'query=expiring')])
    expect((await getSettings()).linePushCount).toBe(10)
    // 走 reply 端點，不是 push
    expect(fakeNet.calls('line').every((c) => c.url.endsWith('/message/reply'))).toBe(true)
  })
})
