import { describe, expect, it } from 'vitest'

import { getSettings } from '@/lib/settings'
import { setQuoteSendingMode } from '@/server/quotes/sending-mode'

import { 報價單, 有客戶, 有報價單, 有網站, 系統設定為 } from '../../support/given'

const OWNER = 'owner@example.com'
/** 規格用中文的模式名稱，服務層用 manual / auto */
const MODE: Record<string, string> = { 手動寄: 'manual', LINE確認後自動寄: 'auto' }
const 管理者切換報價寄送模式 = (mode: string) => setQuoteSendingMode(MODE[mode] ?? mode, OWNER)

describe('切換報價寄送模式', () => {
  it.each(['', '自動寄給客戶'])('寄送模式不合法時操作失敗：「%s」', async (mode) => {
    await 系統設定為({ autoSend: false, lineAdmin: true })
    const r = await 管理者切換報價寄送模式(mode)
    expect(r.violationType).toBe('INVALID_ARGUMENT')
  })

  it('未設定 LINE 管理者時切換為自動寄被拒', async () => {
    await 系統設定為({ autoSend: false, lineAdmin: false })
    const r = await 管理者切換報價寄送模式('LINE確認後自動寄')
    expect(r.violationType).toBe('LINE_ADMIN_NOT_CONFIGURED')
    expect((await getSettings()).autoSendEnabled).toBe(false)
  })

  it('全新系統的寄送模式為手動寄', async () => {
    expect((await getSettings()).autoSendEnabled).toBe(false)
  })

  it.each([
    { before: false, mode: 'LINE確認後自動寄', after: true },
    { before: true, mode: '手動寄', after: false },
  ])('切換寄送模式後設定被更新：$mode', async ({ before, mode, after }) => {
    await 系統設定為({ autoSend: before, lineAdmin: true })
    const r = await 管理者切換報價寄送模式(mode)
    expect(r.ok).toBe(true)
    expect((await getSettings()).autoSendEnabled).toBe(after)
  })

  it('切換為手動寄後待確認報價單狀態不變', async () => {
    await 系統設定為({ autoSend: true, lineAdmin: true })
    await 有客戶('小森咖啡')
    await 有網站('小森咖啡官網', '小森咖啡')
    await 有報價單({ quote_no: '261110', client: '小森咖啡', site: '小森咖啡官網', status: 'pending_approval', anchor_date: '2026-12-20', valid_until: '2026-11-24', total: '8400' })
    const r = await 管理者切換報價寄送模式('手動寄')
    expect(r.ok).toBe(true)
    expect((await 報價單('261110'))?.status).toBe('pending_approval')
  })
})
