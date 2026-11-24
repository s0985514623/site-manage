import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/db'
import { deleteProject } from '@/server/projects/projects'
import { addUpdate, deleteUpdate, listUpdates } from '@/server/updates'

import { 今天是 } from '../../support/clock'
import { 有客戶, 有專案, 有網站, 專案id, 網站id } from '../../support/given'

const OWNER = 'owner@example.com'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])

const png = (name: string) => new File([PNG], name, { type: 'image/png' })
const jpg = (name: string) => new File([JPG], name, { type: 'image/jpeg' })

async function 在專案新增近況(project: string, body: string, images: File[] = []) {
  return addUpdate({ projectId: await 專案id(project) }, { body, images }, OWNER)
}

describe('記錄近況', () => {
  beforeEach(async () => {
    await 有客戶('小森咖啡')
    await 有網站('小森咖啡官網', '小森咖啡')
    await 有專案({ name: '官網改版', client: '小森咖啡', category: 'new_site' })
  })

  it('沒有文字也沒有圖片時操作失敗', async () => {
    const r = await 在專案新增近況('官網改版', '   ')
    expect(r.violationType).toBe('INVALID_ARGUMENT')
  })

  it('圖片格式不符時操作失敗', async () => {
    const pdf = new File([Buffer.from('%PDF-1.4 x')], '報價.pdf', { type: 'application/pdf' })
    const r = await 在專案新增近況('官網改版', '', [pdf])
    expect(r.violationType).toBe('INVALID_ARGUMENT')
    expect(await db.query.updates.findMany()).toHaveLength(0)
  })

  it('超過 10 張圖片時操作失敗', async () => {
    const files = Array.from({ length: 11 }, (_, i) => png(`${i}.png`))
    const r = await 在專案新增近況('官網改版', '', files)
    expect(r.violationType).toBe('INVALID_ARGUMENT')
  })

  it('專案不存在時操作失敗', async () => {
    const r = await addUpdate({ projectId: '00000000-0000-4000-8000-000000000000' }, { body: '測試', images: [] }, OWNER)
    expect(r.violationType).toBe('NOT_FOUND')
  })

  it('在專案新增一則文字近況', async () => {
    const r = await 在專案新增近況('官網改版', '首頁設計稿已寄給客戶')
    expect(r.ok).toBe(true)
    const list = await listUpdates({ projectId: await 專案id('官網改版') })
    expect(list.map((u) => u.body)).toEqual(['首頁設計稿已寄給客戶'])
    expect(list[0].images).toEqual([])
  })

  it('在網站新增帶圖片的近況', async () => {
    const siteId = await 網站id('小森咖啡官網')
    const r = await addUpdate({ siteId }, { body: '外掛更新後版面跑掉', images: [png('a.png'), jpg('b.jpg')] }, OWNER)
    expect(r.ok).toBe(true)
    const list = await listUpdates({ siteId })
    expect(list).toHaveLength(1)
    expect(list[0].body).toBe('外掛更新後版面跑掉')
    expect(list[0].images.map((i) => i.filename)).toEqual(['a.png', 'b.jpg'])
    // 不會跑到專案的對話串
    expect(await listUpdates({ projectId: await 專案id('官網改版') })).toHaveLength(0)
  })

  it('近況依時間由舊到新排列', async () => {
    // 故意先寫較晚的那則，確認排序看的是時間而不是寫入順序
    今天是('2026-11-24')
    await 在專案新增近況('官網改版', '設計稿確認')
    今天是('2026-11-20')
    await 在專案新增近況('官網改版', '需求訪談完成')
    const list = await listUpdates({ projectId: await 專案id('官網改版') })
    expect(list.map((u) => u.body)).toEqual(['需求訪談完成', '設計稿確認'])
  })

  it('刪除近況時一併刪除圖片', async () => {
    const added = await 在專案新增近況('官網改版', '', [png('a.png')])
    const r = await deleteUpdate(added.updateId!, OWNER)
    expect(r.ok).toBe(true)
    expect(await db.query.updates.findMany()).toHaveLength(0)
    expect(await db.query.updateImages.findMany()).toHaveLength(0)
  })

  it('刪除專案時近況一併刪除', async () => {
    await 在專案新增近況('官網改版', '', [png('a.png')])
    const r = await deleteProject(await 專案id('官網改版'), OWNER)
    expect(r.ok).toBe(true)
    expect(await db.query.updates.findMany()).toHaveLength(0)
    expect(await db.query.updateImages.findMany()).toHaveLength(0)
  })
})
