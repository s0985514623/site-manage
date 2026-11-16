import { describe, expect, it } from 'vitest'

import { db } from '@/db'
import { clients } from '@/db/schema'
import { today } from '@/lib/dates'
import { pushToOwner, text } from '@/lib/line'
import { sendMail } from '@/lib/mailer'

import { fakeNet } from './fakes/network'
import { checkTestDatabaseUrl } from './setup/test-db'
import { 今天是 } from './support/clock'

describe('測試基礎', () => {
  it('可以寫入並讀回資料庫', async () => {
    await db.insert(clients).values({ name: '冒煙測試客戶' })
    const rows = await db.select().from(clients)
    expect(rows.map((r) => r.name)).toEqual(['冒煙測試客戶'])
  })

  it('每個測試開始時資料庫是空的', async () => {
    expect(await db.select().from(clients)).toEqual([])
  })

  it('固定時鐘：today() 回台北日期', () => {
    今天是('2026-11-16')
    expect(today()).toBe('2026-11-16')
    // 台北 00:30 時 UTC 還是前一天，today() 仍要是台北日期
    今天是('2026-11-17', '00:30')
    expect(today()).toBe('2026-11-17')
  })

  it('假 LINE 與假 Resend 會記錄請求', async () => {
    await pushToOwner([text('哈囉')])
    await sendMail({ to: ['a@example.com'], subject: '主旨', html: '<p>內文</p>' })
    expect(fakeNet.lineTexts()).toEqual(['哈囉'])
    expect(fakeNet.mails()[0]).toMatchObject({ to: ['a@example.com'], subject: '主旨' })
  })

  it('外部服務可設定失敗', async () => {
    fakeNet.fail('line')
    const result = await pushToOwner([text('x')])
    expect(result.ok).toBe(false)
  })
})

describe('測試資料庫防護', () => {
  it('拒絕非本機資料庫', () => {
    expect(() => checkTestDatabaseUrl('postgresql://u:p@db.example.com:5432/x_test')).toThrow(/不是本機/)
  })

  it('拒絕名稱不以 _test 結尾的資料庫', () => {
    expect(() => checkTestDatabaseUrl('postgresql://u:p@localhost:5433/site_support')).toThrow(/_test/)
  })

  it('接受本機的 _test 資料庫', () => {
    expect(checkTestDatabaseUrl('postgresql://u:p@localhost:5433/site_support_test')).toContain('_test')
  })
})
