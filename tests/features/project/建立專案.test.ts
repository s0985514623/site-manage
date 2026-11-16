import { beforeEach, describe, expect, it } from 'vitest'

import { createProject, type ProjectInput } from '@/server/projects/projects'

import { fakeGoogleCalendar } from '../../fakes/google-calendar'
import { fakeNet } from '../../fakes/network'
import { 客戶id, 專案, 已授權Google日曆, 有客戶, 有網站, 網站id } from '../../support/given'

const 專案管理日曆 = () => fakeGoogleCalendar.events('專案管理')

type Row = {
  name: string
  client: string
  category: string
  site?: string
  start_date?: string
  due_date?: string
  estimated_amount?: string
}

/** 「管理者建立專案」：資料表欄位用名稱，這裡換成 id */
async function 管理者建立專案(row: Row) {
  let clientId = ''
  if (row.client) {
    clientId = await 客戶id(row.client).catch(() => '00000000-0000-4000-8000-000000000000')
  }
  const input: ProjectInput = {
    name: row.name,
    clientId,
    category: row.category,
    siteId: row.site ? await 網站id(row.site) : '',
    startDate: row.start_date ?? '',
    dueDate: row.due_date ?? '',
    estimatedAmount: row.estimated_amount ?? '',
  }
  return createProject(input, 'owner@example.com')
}

describe('建立專案', () => {
  beforeEach(async () => {
    await 有客戶('青禾設計')
    await 有客戶('小森咖啡')
    await 有客戶('停用客戶', 'inactive')
    await 有網站('小森咖啡官網', '小森咖啡')
    await 已授權Google日曆()
  })

  it('類別不在清單內時操作失敗', async () => {
    const r = await 管理者建立專案({ name: '官網改版', client: '青禾設計', category: '網站改版', due_date: '2026-12-31' })
    expect(r.violationType).toBe('INVALID_ARGUMENT')
  })

  it.each([
    { name: '', client: '青禾設計', category: 'new_site' },
    { name: '青禾新官網', client: '', category: 'new_site' },
    { name: '青禾新官網', client: '青禾設計', category: '' },
  ])('缺少必填欄位時操作失敗：%o', async (row) => {
    const r = await 管理者建立專案(row)
    expect(r.violationType).toBe('INVALID_ARGUMENT')
  })

  it('名稱只有空白時操作失敗', async () => {
    const r = await 管理者建立專案({ name: '  ', client: '青禾設計', category: 'new_site' })
    expect(r.violationType).toBe('INVALID_ARGUMENT')
  })

  it('截止日早於開始日時操作失敗', async () => {
    const r = await 管理者建立專案({
      name: '青禾新官網',
      client: '青禾設計',
      category: 'new_site',
      start_date: '2026-12-01',
      due_date: '2026-11-30',
    })
    expect(r.violationType).toBe('INVALID_DATE_RANGE')
  })

  it('預估金額為負數時操作失敗', async () => {
    const r = await 管理者建立專案({ name: '青禾新官網', client: '青禾設計', category: 'new_site', estimated_amount: '-1' })
    expect(r.violationType).toBe('INVALID_ARGUMENT')
  })

  it('網站屬於其他客戶時操作失敗', async () => {
    const r = await 管理者建立專案({ name: '修正表單', client: '青禾設計', category: 'bug_fix', site: '小森咖啡官網' })
    expect(r.violationType).toBe('SITE_CLIENT_MISMATCH')
  })

  it.each([
    { client: '不存在客戶', violation: 'NOT_FOUND' },
    { client: '停用客戶', violation: 'CLIENT_INACTIVE' },
  ])('客戶不存在或已停用時操作失敗：$client', async ({ client, violation }) => {
    const r = await 管理者建立專案({ name: '新專案', client, category: 'other' })
    expect(r.violationType).toBe(violation)
  })

  it.each([
    { name: '青禾新官網', client: '青禾設計', category: 'new_site', site: '' },
    { name: '會員集點外掛', client: '小森咖啡', category: 'custom_plugin', site: '小森咖啡官網' },
    { name: '結帳頁修正', client: '小森咖啡', category: 'bug_fix', site: '小森咖啡官網' },
    { name: '年度健檢', client: '小森咖啡', category: 'other', site: '' },
  ])('各類別專案建立後狀態為待開始：$name', async (row) => {
    const r = await 管理者建立專案({ ...row, start_date: '2026-11-20', due_date: '2026-12-31', estimated_amount: '60000' })
    expect(r.ok).toBe(true)
    const p = await 專案(row.name)
    expect(p).toMatchObject({
      clientId: await 客戶id(row.client),
      category: row.category,
      siteId: row.site ? await 網站id(row.site) : null,
      status: 'not_started',
      dueDate: '2026-12-31',
    })
  })

  it('有截止日的專案寫入專案管理日曆', async () => {
    await 管理者建立專案({
      name: '青禾新官網',
      client: '青禾設計',
      category: 'new_site',
      start_date: '2026-11-20',
      due_date: '2026-12-31',
    })
    expect(專案管理日曆()).toMatchObject([{ title: '【專案截止】青禾設計 · 青禾新官網', date: '2026-12-31' }])
    // 與「網站到期管理」日曆分開
    expect(fakeGoogleCalendar.events('網站到期管理')).toEqual([])
  })

  it('沒有截止日的專案不建立日曆事件', async () => {
    await 管理者建立專案({ name: '年度健檢', client: '青禾設計', category: 'other' })
    expect(專案管理日曆()).toEqual([])
  })

  it('日曆無法連線時專案仍建立成功', async () => {
    fakeNet.fail('google')
    const r = await 管理者建立專案({ name: '青禾新官網', client: '青禾設計', category: 'new_site', due_date: '2026-12-31' })
    expect(r.ok).toBe(true)
    expect(await 專案('青禾新官網')).toMatchObject({ status: 'not_started', gcalEventId: null })
  })
})
