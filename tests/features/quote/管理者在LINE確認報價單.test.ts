import { beforeEach, describe, expect, it } from 'vitest'

import { createApproval } from '@/lib/approvals'

import { fakeNet } from '../../fakes/network'
import { 報價單, 有報價單, 有報價收件人, 有客戶, 有網站, 系統設定為 } from '../../support/given'
import { LINE事件, postback } from '../../support/line'

describe('管理者在LINE確認報價單', () => {
  let token: string

  beforeEach(async () => {
    await 有客戶('小森咖啡')
    await 有網站('小森咖啡官網', '小森咖啡')
    await 有報價收件人('小森咖啡', 'boss@morimori.tw')
    const q = await 有報價單({ quote_no: '261110', client: '小森咖啡', site: '小森咖啡官網', status: 'pending_approval', anchor_date: '2026-12-20', valid_until: '2026-11-24', total: '8400' })
    // 報價單 "261110" 有一組未使用的 LINE 確認 token
    token = await createApproval(q.id)
  })

  it('手動寄模式下按 LINE 確認按鈕不寄信', async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true })
    await LINE事件([postback(`act=approve&t=${token}`)])
    expect(fakeNet.lineTexts().join('\n')).toContain('目前為手動寄送模式，請至後台按寄出')
    expect(fakeNet.mails()).toHaveLength(0)
    expect((await 報價單('261110'))?.status).toBe('pending_approval')
  })

  it('自動寄模式下按確認後寄出報價單', async () => {
    await 系統設定為({ autoSend: true, lineAdmin: true })
    await LINE事件([postback(`act=approve&t=${token}`)])
    const mails = fakeNet.mails()
    expect(mails).toHaveLength(1)
    expect(mails[0].to).toEqual(['boss@morimori.tw'])
    expect(mails[0].subject).toContain('261110')
    const q = await 報價單('261110')
    expect(q?.status).toBe('sent')
    expect(q?.sentAt?.toISOString()).toBe(new Date('2026-11-16T10:00:00+08:00').toISOString())
  })

  it('切回自動寄後同一個 token 仍可使用', async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true })
    await LINE事件([postback(`act=approve&t=${token}`)])
    await 系統設定為({ autoSend: true, lineAdmin: true })
    await LINE事件([postback(`act=approve&t=${token}`)])
    expect((await 報價單('261110'))?.status).toBe('sent')
  })
})
