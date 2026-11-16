import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/db'
import { quotes } from '@/db/schema'
import { syncProjectDue } from '@/server/projects/calendar'
import { deleteProject, updateProject } from '@/server/projects/projects'

import { fakeGoogleCalendar } from '../../fakes/google-calendar'
import { 客戶id, 專案, 專案id, 已授權Google日曆, 有客戶, 有專案, 有網站, 有里程碑, 網站id } from '../../support/given'

const 專案管理日曆 = () => fakeGoogleCalendar.events('專案管理')
const OWNER = 'owner@example.com'

async function 管理者編輯專案(name: string, row: { name: string; site: string; start_date: string; due_date: string }) {
  const id = await 專案id(name).catch(() => '00000000-0000-4000-8000-000000000000')
  return updateProject(
    id,
    {
      name: row.name,
      siteId: row.site ? await 網站id(row.site) : '',
      startDate: row.start_date,
      dueDate: row.due_date,
    },
    OWNER,
  )
}

describe('編輯專案', () => {
  beforeEach(async () => {
    await 有客戶('青禾設計')
    await 有客戶('小森咖啡')
    await 有網站('小森咖啡官網', '小森咖啡')
    await 已授權Google日曆()
    const p = await 有專案({
      name: '青禾新官網',
      client: '青禾設計',
      category: 'new_site',
      status: 'in_progress',
      startDate: '2026-11-01',
      dueDate: '2026-12-31',
    })
    // 專案 "青禾新官網" 在「專案管理」日曆有截止日事件
    await syncProjectDue(p.id)
  })

  it.each([
    { name: '', site: '', start_date: '2026-11-01', due_date: '2026-12-31', violation: 'INVALID_ARGUMENT' },
    { name: '青禾新官網', site: '', start_date: '2026-11-01', due_date: '2026-10-31', violation: 'INVALID_DATE_RANGE' },
    { name: '青禾新官網', site: '小森咖啡官網', start_date: '2026-11-01', due_date: '2026-12-31', violation: 'SITE_CLIENT_MISMATCH' },
  ])('修改內容不合法時操作失敗：$violation', async ({ violation, ...row }) => {
    const r = await 管理者編輯專案('青禾新官網', row)
    expect(r.violationType).toBe(violation)
  })

  it('專案不存在時操作失敗', async () => {
    const r = await 管理者編輯專案('不存在的專案', { name: '改名', site: '', start_date: '', due_date: '' })
    expect(r.violationType).toBe('NOT_FOUND')
  })

  it('變更截止日後日曆事件日期同步更新', async () => {
    const r = await 管理者編輯專案('青禾新官網', { name: '青禾新官網', site: '', start_date: '2026-11-01', due_date: '2027-01-15' })
    expect(r.ok).toBe(true)
    expect(專案管理日曆()).toMatchObject([{ title: '【專案截止】青禾設計 · 青禾新官網', date: '2027-01-15' }])
  })

  it('清除截止日後日曆事件被刪除', async () => {
    const r = await 管理者編輯專案('青禾新官網', { name: '青禾新官網', site: '', start_date: '2026-11-01', due_date: '' })
    expect(r.ok).toBe(true)
    expect(專案管理日曆()).toEqual([])
  })

  it('有報價單的專案無法刪除', async () => {
    await db.insert(quotes).values({
      quoteNo: '261105',
      clientId: await 客戶id('青禾設計'),
      projectId: await 專案id('青禾新官網'),
      status: 'draft',
      issueDate: '2026-11-05',
      validUntil: '2026-11-19',
      total: '120000',
    })
    const r = await deleteProject(await 專案id('青禾新官網'), OWNER)
    expect(r.violationType).toBe('PROJECT_HAS_QUOTES')
  })

  it('刪除專案後里程碑與日曆事件一併移除', async () => {
    const m = await 有里程碑('青禾新官網', '設計稿確認', '2026-11-25')
    const { syncMilestone } = await import('@/server/projects/calendar')
    await syncMilestone(m.id)
    expect(專案管理日曆()).toHaveLength(2)

    const r = await deleteProject(await 專案id('青禾新官網'), OWNER)
    expect(r.ok).toBe(true)
    expect(await 專案('青禾新官網')).toBeUndefined()
    expect(await db.query.projectMilestones.findMany()).toEqual([])
    expect(專案管理日曆()).toEqual([])
  })
})
