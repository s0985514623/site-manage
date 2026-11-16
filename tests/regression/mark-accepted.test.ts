import { describe, expect, it } from 'vitest'

import { markAccepted } from '@/server/actions/quotes'

import { 報價單, 有報價單, 有客戶, 有網站 } from '../support/given'

/** 客戶同意時記錄 accepted_at（專案報價未收款提醒的起算點），只記第一次 */
describe('標記客戶已同意', () => {
  it('記下同意時間，重按不覆蓋', async () => {
    await 有客戶('小森咖啡')
    await 有網站('小森咖啡官網', '小森咖啡')
    const q = await 有報價單({ quote_no: '261110', client: '小森咖啡', site: '小森咖啡官網', status: 'sent', sent_at: '2026-11-10T10:00:00+08:00', anchor_date: '2026-12-20', valid_until: '2026-11-24', total: '8400' })
    const form = new FormData()
    form.set('id', q.id)

    expect((await markAccepted({}, form)).ok).toBe(true)
    const first = (await 報價單('261110'))?.acceptedAt?.toISOString()
    expect(first).toBe(new Date('2026-11-16T10:00:00+08:00').toISOString())

    await markAccepted({}, form)
    expect((await 報價單('261110'))?.acceptedAt?.toISOString()).toBe(first)
  })
})
