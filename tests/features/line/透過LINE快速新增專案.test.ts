import { inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/db'
import { clients } from '@/db/schema'

import { fakeGoogleCalendar } from '../../fakes/google-calendar'
import { fakeNet } from '../../fakes/network'
import {
  LINE快速新增進度,
  LINE快速新增進度為,
  客戶id,
  專案,
  已授權Google日曆,
  有客戶,
  系統設定為,
} from '../../support/given'
import { LINE事件, 傳送, 非管理者 } from '../../support/line'

const 回覆 = () => fakeNet.lineTexts().join('\n')
const 按鈕 = () => fakeNet.lineQuickReplyLabels()

describe('透過LINE快速新增專案', () => {
  beforeEach(async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true })
    await 有客戶('青禾設計')
    await 有客戶('小森咖啡')
    await 有客戶('停用客戶', 'inactive')
    await 已授權Google日曆()
  })

  it('非管理者開始新增時回覆無權限', async () => {
    await LINE事件([傳送('postback', 'add=project', 非管理者)])
    expect(回覆()).toContain('這個帳號沒有操作權限')
    expect(await LINE快速新增進度()).toBeUndefined()
  })

  it('開始新增時列出啟用中客戶', async () => {
    await LINE事件([傳送('postback', 'add=project')])
    // 客戶依最近異動排序；這裡只比對有哪些按鈕
    expect([...按鈕()].sort()).toEqual(['青禾設計', '小森咖啡', '輸入關鍵字搜尋', '取消'].sort())
    expect(按鈕().slice(-2)).toEqual(['輸入關鍵字搜尋', '取消'])
    expect((await LINE快速新增進度())?.step).toBe('choose_client')
  })

  it('超過 12 位客戶時只列最近異動的 12 位', async () => {
    for (let i = 1; i <= 13; i++) {
      await db.insert(clients).values({ name: `客戶${String(i).padStart(2, '0')}`, updatedAt: new Date(`2026-11-${String(i).padStart(2, '0')}T09:00:00+08:00`) })
    }
    // 原本的兩位客戶更早
    await db.update(clients).set({ updatedAt: new Date('2026-10-01T00:00:00+08:00') }).where(inArray(clients.name, ['青禾設計', '小森咖啡']))
    await LINE事件([傳送('postback', 'add=project')])
    // LINE 快速回覆上限 13 顆：12 位客戶 + 「輸入關鍵字搜尋」，取消改為輸入文字
    expect(按鈕()).toHaveLength(13)
    expect(按鈕().at(-1)).toBe('輸入關鍵字搜尋')
    expect(回覆()).toContain('輸入「取消」可結束')
    const labels = 按鈕().slice(0, -1)
    expect(labels).toHaveLength(12)
    expect(labels[0]).toBe('客戶13')
    expect(labels).not.toContain('客戶01')
    expect(labels).not.toContain('停用客戶')
  })

  it('以關鍵字搜尋客戶', async () => {
    await LINE快速新增進度為({ step: 'choose_client', updatedAt: '2026-11-16T09:55:00+08:00' })
    await LINE事件([傳送('message', '青禾')])
    expect(按鈕()).toEqual(['青禾設計', '取消'])
  })

  it('選好客戶後列出四個類別', async () => {
    await LINE快速新增進度為({ step: 'choose_client', updatedAt: '2026-11-16T09:55:00+08:00' })
    await LINE事件([傳送('postback', 'client=青禾設計')])
    expect(按鈕()).toEqual(['新網站', '客製化外掛', 'BUG 排除', '其他', '取消'])
    expect(await LINE快速新增進度()).toMatchObject({ step: 'choose_category', data: { clientId: await 客戶id('青禾設計') } })
  })

  it('名稱只有空白時重新要求輸入', async () => {
    await LINE快速新增進度為({ step: 'input_name', client: '青禾設計', category: 'new_site', updatedAt: '2026-11-16T09:55:00+08:00' })
    await LINE事件([傳送('message', '   ')])
    expect(回覆()).toContain('請輸入專案名稱')
    expect((await LINE快速新增進度())?.step).toBe('input_name')
  })

  it.each([
    { type: 'datetime', value: '2026-12-31', due_date: '2026-12-31' },
    { type: 'postback', value: 'skip', due_date: null },
  ])('選日期或略過後建立專案：$type', async ({ type, value, due_date }) => {
    await LINE快速新增進度為({ step: 'choose_due_date', client: '青禾設計', category: 'new_site', name: '青禾新官網', updatedAt: '2026-11-16T09:55:00+08:00' })
    await LINE事件([傳送(type, value)])
    expect(await 專案('青禾新官網')).toMatchObject({
      clientId: await 客戶id('青禾設計'),
      category: 'new_site',
      status: 'not_started',
      dueDate: due_date,
    })
  })

  it('搜尋只找到停用客戶時不列出', async () => {
    await LINE快速新增進度為({ step: 'choose_client', updatedAt: '2026-11-16T09:55:00+08:00' })
    await LINE事件([傳送('message', '停用')])
    expect(回覆()).toContain('找不到符合的客戶')
  })

  it('按取消後結束且不建立專案', async () => {
    await LINE快速新增進度為({ step: 'input_name', client: '青禾設計', category: 'new_site', updatedAt: '2026-11-16T09:55:00+08:00' })
    await LINE事件([傳送('postback', 'cancel')])
    expect(回覆()).toContain('已取消')
    expect(await LINE快速新增進度()).toBeUndefined()
    expect(await db.query.projects.findMany()).toEqual([])
  })

  it.each([
    { updatedAt: '2026-11-16T09:30:00+08:00', contains: '請選擇截止日' },
    { updatedAt: '2026-11-16T09:29:00+08:00', contains: '上一次新增已逾時，請重新開始' },
  ])('依閒置時間判斷進度是否過期：$updatedAt', async ({ updatedAt, contains }) => {
    await LINE快速新增進度為({ step: 'input_name', client: '青禾設計', category: 'new_site', updatedAt })
    await LINE事件([傳送('message', '青禾新官網')])
    expect(回覆()).toContain(contains)
  })

  it('輸入「取消」文字也能結束', async () => {
    await LINE快速新增進度為({ step: 'choose_client', updatedAt: '2026-11-16T09:55:00+08:00' })
    await LINE事件([傳送('message', '取消')])
    expect(回覆()).toContain('已取消')
    expect(await LINE快速新增進度()).toBeUndefined()
  })

  it('選類別時傳文字會重新提示', async () => {
    await LINE快速新增進度為({ step: 'choose_category', client: '青禾設計', updatedAt: '2026-11-16T09:55:00+08:00' })
    await LINE事件([傳送('message', '網站')])
    expect(回覆()).toContain('請點選下方類別按鈕')
    expect((await LINE快速新增進度())?.step).toBe('choose_category')
  })

  it('LINE 新增的專案寫入專案管理日曆', async () => {
    await LINE快速新增進度為({ step: 'choose_due_date', client: '青禾設計', category: 'new_site', name: '青禾新官網', updatedAt: '2026-11-16T09:55:00+08:00' })
    await LINE事件([傳送('datetime', '2026-12-31')])
    expect(fakeGoogleCalendar.events('專案管理')).toMatchObject([{ title: '【專案截止】青禾設計 · 青禾新官網', date: '2026-12-31' }])
    expect(await LINE快速新增進度()).toBeUndefined()
  })

  it('建立成功後回覆摘要', async () => {
    await LINE快速新增進度為({ step: 'choose_due_date', client: '青禾設計', category: 'new_site', name: '青禾新官網', updatedAt: '2026-11-16T09:55:00+08:00' })
    await LINE事件([傳送('datetime', '2026-12-31')])
    expect(回覆()).toContain('已建立：青禾設計 · 青禾新官網（新網站，12/31 截止）')
    expect(回覆()).toContain('/projects/')
  })

  it('完整走一次：開始 → 客戶 → 類別 → 名稱 → 日期', async () => {
    await LINE事件([傳送('postback', 'add=project')])
    await LINE事件([傳送('postback', `client=${await 客戶id('小森咖啡')}`)])
    await LINE事件([傳送('postback', 'category=custom_plugin')])
    await LINE事件([傳送('message', '會員集點外掛')])
    await LINE事件([傳送('datetime', '2027-01-15')])
    expect(await 專案('會員集點外掛')).toMatchObject({ category: 'custom_plugin', dueDate: '2027-01-15' })
    expect(await LINE快速新增進度()).toBeUndefined()
  })
})
