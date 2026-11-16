import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/db'
import { sendQuoteToClient } from '@/server/send-quote'

import { fakeNet } from '../../fakes/network'
import {
  報價單,
  報價單包含服務項目,
  寄信服務未設定,
  有報價單,
  有報價收件人,
  有客戶,
  有專案,
  有服務項目,
  有網站,
  系統設定為,
} from '../../support/given'

const OWNER = 'owner@example.com'

async function 管理者寄出報價單(quoteNo: string) {
  const q = await 報價單(quoteNo)
  return sendQuoteToClient(q!.id, OWNER)
}

const 小森報價 = (status: Parameters<typeof 有報價單>[0]['status'], total = '8400') =>
  有報價單({ quote_no: '261110', client: '小森咖啡', site: '小森咖啡官網', status, anchor_date: '2026-12-20', valid_until: '2026-11-24', total })

describe('管理者手動寄出報價單', () => {
  beforeEach(async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true })
    await 有客戶('小森咖啡')
    await 有客戶('青禾設計')
    await 有網站('小森咖啡官網', '小森咖啡')
    await 有專案({ name: '會員集點外掛', client: '青禾設計', category: 'custom_plugin', status: 'in_progress', startDate: '2026-11-01', dueDate: '2026-12-31' })
    await 有報價收件人('小森咖啡', 'boss@morimori.tw')
    await 有報價收件人('青禾設計', 'pm@qinghe.design')
  })

  it.each(['accepted', 'cancelled'] as const)('報價單狀態不允許寄出時操作失敗：%s', async (status) => {
    await 小森報價(status)
    const r = await 管理者寄出報價單('261110')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.violationType).toBe('INVALID_QUOTE_STATUS')
  })

  it('連續按兩次寄出只寄出一封', async () => {
    await 小森報價('draft')
    const results = await Promise.all([管理者寄出報價單('261110'), 管理者寄出報價單('261110')])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    const failed = results.find((r) => !r.ok)
    expect(failed && !failed.ok && failed.violationType).toBe('QUOTE_ALREADY_SENT')
    const mails = fakeNet.mails()
    expect(mails).toHaveLength(1)
    expect(mails[0].to).toEqual(['boss@morimori.tw'])
    expect(mails[0].subject).toContain('261110')
  })

  it('客戶沒有報價收件人時操作失敗', async () => {
    await 有客戶('無窗口公司')
    await 有網站('無窗口官網', '無窗口公司')
    await 有報價單({ quote_no: '261111', client: '無窗口公司', site: '無窗口官網', status: 'draft', anchor_date: '2026-12-20', valid_until: '2026-11-24', total: '3000' })
    const r = await 管理者寄出報價單('261111')
    expect(!r.ok && r.violationType).toBe('NO_RECIPIENT')
    expect(fakeNet.mails()).toHaveLength(0)
  })

  it('寄信服務未設定時操作失敗', async () => {
    寄信服務未設定()
    await 小森報價('draft')
    const r = await 管理者寄出報價單('261110')
    expect(!r.ok && r.violationType).toBe('MAIL_NOT_CONFIGURED')
  })

  it.each(['draft', 'pending_approval'] as const)('草稿或待確認的報價單寄出成功：%s', async (status) => {
    await 小森報價(status)
    const r = await 管理者寄出報價單('261110')
    expect(r.ok).toBe(true)
    const q = await 報價單('261110')
    expect(q?.status).toBe('sent')
    expect(q?.sentAt?.toISOString()).toBe(new Date('2026-11-16T10:00:00+08:00').toISOString())
    expect(q?.sentTo).toEqual(['boss@morimori.tw'])
  })

  it('寄出後服務項目續約狀態同步為已寄出', async () => {
    await 有服務項目('小森咖啡官網', { type: 'domain', identifier: 'morimori.com.tw', expiresAt: '2026-12-20', priceAmount: '1200' })
    await 小森報價('draft', '1260')
    await 報價單包含服務項目('261110', 'morimori.com.tw')
    await 管理者寄出報價單('261110')
    const s = await db.query.services.findFirst({ where: (t, { eq }) => eq(t.identifier, 'morimori.com.tw') })
    expect(s?.renewalState).toBe('sent')
  })

  it('寄信服務回報失敗時報價單維持草稿', async () => {
    await 小森報價('draft')
    fakeNet.fail('resend')
    const r = await 管理者寄出報價單('261110')
    expect(!r.ok && r.violationType).toBe('MAIL_SEND_FAILED')
    const q = await 報價單('261110')
    expect(q).toMatchObject({ status: 'draft', sentAt: null })
  })

  it('專案報價單寄出時主旨使用專案名稱', async () => {
    await 有報價單({ quote_no: '261112', client: '青禾設計', project: '會員集點外掛', status: 'draft', valid_until: '2026-11-30', total: '52500' })
    const r = await 管理者寄出報價單('261112')
    expect(r.ok).toBe(true)
    const mails = fakeNet.mails()
    expect(mails[0].to).toEqual(['pm@qinghe.design'])
    expect(mails[0].subject).toContain('青禾設計 會員集點外掛 報價單')
    expect(mails[0].subject).not.toContain('續約')
  })
})
