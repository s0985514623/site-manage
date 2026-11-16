import { beforeEach, describe, expect, it } from 'vitest'

import { listProjects } from '@/server/projects/projects'

import { 有客戶, 有專案 } from '../../support/given'

describe('查詢專案列表', () => {
  beforeEach(async () => {
    await 有客戶('青禾設計')
    await 有客戶('小森咖啡')
    await 有專案({ name: '青禾新官網', client: '青禾設計', category: 'new_site', status: 'in_progress', startDate: '2026-11-01', dueDate: '2026-12-31' })
    await 有專案({ name: '會員集點外掛', client: '小森咖啡', category: 'custom_plugin', status: 'in_review', startDate: '2026-10-01', dueDate: '2026-11-10' })
    await 有專案({ name: '結帳頁修正', client: '小森咖啡', category: 'bug_fix', status: 'completed', startDate: '2026-10-20', dueDate: '2026-10-25' })
    await 有專案({ name: '年度健檢', client: '青禾設計', category: 'other', status: 'not_started' })
  })

  it('只看客製化外掛類別', async () => {
    const rows = await listProjects({ category: 'custom_plugin' })
    expect(rows.map((r) => r.name)).toEqual(['會員集點外掛'])
  })

  it('只看已完成的專案', async () => {
    const rows = await listProjects({ status: 'completed' })
    expect(rows.map((r) => r.name)).toEqual(['結帳頁修正'])
  })

  it('不篩選時依截止日排序', async () => {
    const rows = await listProjects({})
    expect(
      rows.map((r) => ({ client: r.clientName, name: r.name, category: r.category, status: r.status, due_date: r.dueDate })),
    ).toEqual([
      { client: '小森咖啡', name: '結帳頁修正', category: 'bug_fix', status: 'completed', due_date: '2026-10-25' },
      { client: '小森咖啡', name: '會員集點外掛', category: 'custom_plugin', status: 'in_review', due_date: '2026-11-10' },
      { client: '青禾設計', name: '青禾新官網', category: 'new_site', status: 'in_progress', due_date: '2026-12-31' },
      { client: '青禾設計', name: '年度健檢', category: 'other', status: 'not_started', due_date: null },
    ])
  })

  it('逾期且未完成的專案被標示', async () => {
    const rows = await listProjects({})
    expect(rows.map((r) => ({ name: r.name, overdue: r.overdue }))).toEqual([
      { name: '結帳頁修正', overdue: false },
      { name: '會員集點外掛', overdue: true },
      { name: '青禾新官網', overdue: false },
      { name: '年度健檢', overdue: false },
    ])
  })
})
