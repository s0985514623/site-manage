import { beforeEach, describe, expect, it } from 'vitest'

import { updateProjectStatus } from '@/server/projects/projects'

import { 專案, 專案id, 有客戶, 有專案 } from '../../support/given'

const OWNER = 'owner@example.com'
type Status = 'not_started' | 'in_progress' | 'in_review' | 'completed'

async function 管理者更新專案狀態(name: string, status: string) {
  return updateProjectStatus(await 專案id(name), status, OWNER)
}

describe('更新專案狀態', () => {
  beforeEach(async () => {
    await 有客戶('青禾設計')
  })

  it('狀態不在清單內時操作失敗', async () => {
    await 有專案({ name: '青禾新官網', client: '青禾設計', category: 'new_site', status: 'in_progress' })
    const r = await 管理者更新專案狀態('青禾新官網', 'cancelled')
    expect(r.violationType).toBe('INVALID_ARGUMENT')
  })

  it.each<{ from: Status; to: Status }>([
    { from: 'not_started', to: 'in_progress' },
    { from: 'in_review', to: 'in_progress' },
    { from: 'not_started', to: 'completed' },
    { from: 'completed', to: 'in_review' },
  ])('任意狀態切換皆成功：$from → $to', async ({ from, to }) => {
    await 有專案({ name: '會員集點外掛', client: '青禾設計', category: 'custom_plugin', status: from })
    const r = await 管理者更新專案狀態('會員集點外掛', to)
    expect(r.ok).toBe(true)
    expect((await 專案('會員集點外掛'))?.status).toBe(to)
  })

  it('新網站專案第一次完成時要求轉維運', async () => {
    await 有專案({ name: '青禾新官網', client: '青禾設計', category: 'new_site', status: 'in_review' })
    const r = await 管理者更新專案狀態('青禾新官網', 'completed')
    expect(r).toMatchObject({ ok: true, status: 'completed', handoverRequired: true })
  })

  it('已轉維運的新網站專案再次完成不再要求', async () => {
    await 有專案({
      name: '青禾新官網',
      client: '青禾設計',
      category: 'new_site',
      status: 'in_review',
      handoverCompletedAt: '2026-11-10T10:00:00+08:00',
    })
    const r = await 管理者更新專案狀態('青禾新官網', 'completed')
    expect(r).toMatchObject({ status: 'completed', handoverRequired: false })
  })

  it.each([
    { name: '會員集點外掛', category: 'custom_plugin' as const },
    { name: '結帳頁修正', category: 'bug_fix' as const },
    { name: '年度健檢', category: 'other' as const },
  ])('非新網站類別完成時不要求轉維運：$category', async ({ name, category }) => {
    await 有專案({ name, client: '青禾設計', category, status: 'in_review' })
    const r = await 管理者更新專案狀態(name, 'completed')
    expect(r).toMatchObject({ status: 'completed', handoverRequired: false })
  })
})
