import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/db'
import { syncMilestone } from '@/server/projects/calendar'
import { addMilestone, deleteMilestone, toggleMilestoneDone, updateMilestone } from '@/server/projects/milestones'

import { fakeGoogleCalendar } from '../../fakes/google-calendar'
import { fakeNet } from '../../fakes/network'
import { 專案id, 已授權Google日曆, 有客戶, 有專案, 有里程碑 } from '../../support/given'

const OWNER = 'owner@example.com'
const 專案管理日曆 = () => fakeGoogleCalendar.events('專案管理')

async function 管理者為專案新增里程碑(project: string, row: { name: string; due_on: string; start_on?: string }) {
  const id = await 專案id(project).catch(() => '00000000-0000-4000-8000-000000000000')
  return addMilestone(id, { name: row.name, startOn: row.start_on, dueOn: row.due_on }, OWNER)
}

async function 里程碑(name: string) {
  return db.query.projectMilestones.findFirst({ where: (t, { eq }) => eq(t.name, name) })
}

describe('管理專案里程碑', () => {
  beforeEach(async () => {
    await 有客戶('青禾設計')
    await 有專案({ name: '青禾新官網', client: '青禾設計', category: 'new_site', status: 'in_progress', startDate: '2026-11-01' })
    await 已授權Google日曆()
  })

  it.each([
    { name: '', due_on: '2026-11-25' },
    { name: '  ', due_on: '2026-11-25' },
    { name: '設計稿確認', due_on: '' },
  ])('里程碑資料不合法時操作失敗：%o', async (row) => {
    const r = await 管理者為專案新增里程碑('青禾新官網', row)
    expect(r.violationType).toBe('INVALID_ARGUMENT')
  })

  it('時程開始日晚於結束日時操作失敗', async () => {
    const r = await 管理者為專案新增里程碑('青禾新官網', { name: '前端開發', start_on: '2026-12-10', due_on: '2026-11-20' })
    expect(r.violationType).toBe('INVALID_DATE_RANGE')
  })

  it('專案不存在時無法新增里程碑', async () => {
    const r = await 管理者為專案新增里程碑('不存在的專案', { name: '設計稿確認', due_on: '2026-11-25' })
    expect(r.violationType).toBe('NOT_FOUND')
  })

  it('新增里程碑後寫入專案管理日曆', async () => {
    const r = await 管理者為專案新增里程碑('青禾新官網', { name: '設計稿確認', due_on: '2026-11-25' })
    expect(r.ok).toBe(true)
    expect(專案管理日曆()).toMatchObject([{ title: '【里程碑】青禾設計 · 青禾新官網 · 設計稿確認', date: '2026-11-25' }])
  })

  it('修改里程碑日期後日曆事件同步更新', async () => {
    const m = await 有里程碑('青禾新官網', '設計稿確認', '2026-11-25')
    await syncMilestone(m.id)
    const r = await updateMilestone(m.id, { name: '設計稿確認', dueOn: '2026-11-28' }, OWNER)
    expect(r.ok).toBe(true)
    expect(專案管理日曆()).toMatchObject([{ title: '【里程碑】青禾設計 · 青禾新官網 · 設計稿確認', date: '2026-11-28' }])
  })

  it('日曆無法連線時里程碑仍新增成功', async () => {
    fakeNet.fail('google')
    const r = await 管理者為專案新增里程碑('青禾新官網', { name: '設計稿確認', due_on: '2026-11-25' })
    expect(r.ok).toBe(true)
    expect(await 里程碑('設計稿確認')).toMatchObject({ dueOn: '2026-11-25', gcalEventId: null })
  })

  it('新增多段時程後各自寫入日曆', async () => {
    const a = await 管理者為專案新增里程碑('青禾新官網', { name: '前端開發', start_on: '2026-11-20', due_on: '2026-12-10' })
    const b = await 管理者為專案新增里程碑('青禾新官網', { name: '後端開發', start_on: '2026-11-25', due_on: '2026-12-20' })
    expect(a.ok && b.ok).toBe(true)
    expect(專案管理日曆().map(({ title, date, endDate }) => ({ title, date, endDate }))).toEqual([
      { title: '【時程】青禾設計 · 青禾新官網 · 前端開發', date: '2026-11-20', endDate: '2026-12-10' },
      { title: '【時程】青禾設計 · 青禾新官網 · 後端開發', date: '2026-11-25', endDate: '2026-12-20' },
    ])
  })

  it('修改時程起訖後日曆事件同步更新', async () => {
    const m = await 有里程碑('青禾新官網', '前端開發', '2026-12-10', '2026-11-20')
    await syncMilestone(m.id)
    const r = await updateMilestone(m.id, { name: '前端開發', startOn: '2026-11-23', dueOn: '2026-12-15' }, OWNER)
    expect(r.ok).toBe(true)
    expect(專案管理日曆().map(({ title, date, endDate }) => ({ title, date, endDate }))).toEqual([
      { title: '【時程】青禾設計 · 青禾新官網 · 前端開發', date: '2026-11-23', endDate: '2026-12-15' },
    ])
  })

  it('單日里程碑的日曆事件只佔當天', async () => {
    await 管理者為專案新增里程碑('青禾新官網', { name: '設計稿確認', due_on: '2026-11-25' })
    expect(專案管理日曆()[0]).toMatchObject({ date: '2026-11-25', endDate: '2026-11-25' })
  })

  it('刪除里程碑後日曆事件被移除', async () => {
    const m = await 有里程碑('青禾新官網', '設計稿確認', '2026-11-25')
    await syncMilestone(m.id)
    const r = await deleteMilestone(m.id, OWNER)
    expect(r.ok).toBe(true)
    expect(專案管理日曆()).toEqual([])
  })

  it('標記里程碑完成後日曆事件保留', async () => {
    const m = await 有里程碑('青禾新官網', '設計稿確認', '2026-11-15')
    await syncMilestone(m.id)
    const r = await toggleMilestoneDone(m.id, OWNER)
    expect(r.ok).toBe(true)
    expect((await 里程碑('設計稿確認'))?.completedAt?.toISOString()).toBe(
      new Date('2026-11-16T10:00:00+08:00').toISOString(),
    )
    expect(專案管理日曆()).toMatchObject([{ title: '【里程碑】青禾設計 · 青禾新官網 · 設計稿確認', date: '2026-11-15' }])
  })
})
