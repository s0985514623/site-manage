import { and, desc, eq, ilike } from 'drizzle-orm'

import { db } from '@/db'
import { clients, lineConversations, type LineConversation } from '@/db/schema'
import { env } from '@/lib/env'
import { button, text, type LineMessage, type QuickReplyAction } from '@/lib/line'
import { CATEGORY_LABEL, createProject, type ProjectCategory } from '@/server/projects/projects'
import { shortDate } from './query'

/**
 * LINE 快速新增專案：以按鈕逐步問答（選客戶 → 選類別 → 輸入名稱 → 選截止日）。
 *
 * 進度存在 line_conversations（每個 LINE 帳號一列）。每一步都可按「取消」；
 * 閒置超過 30 分鐘視為放棄，下次互動時提示重新開始。完成、取消、逾時都刪除進度。
 * 建立專案走與網頁後台相同的 createProject（驗證規則、日曆同步都一樣）。
 */

const IDLE_MINUTES = 30
const CLIENT_BUTTONS = 12

export type QuickAddInput =
  | { kind: 'postback'; data: string; date?: string }
  | { kind: 'message'; text: string }

const CANCEL = button('取消', 'cancel')

function expiresFromNow(): Date {
  return new Date(Date.now() + IDLE_MINUTES * 60_000)
}

async function save(userId: string, step: LineConversation['step'], data: LineConversation['data']) {
  await db
    .insert(lineConversations)
    .values({ lineUserId: userId, step, data, expiresAt: expiresFromNow(), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: lineConversations.lineUserId,
      set: { step, data, expiresAt: expiresFromNow(), updatedAt: new Date() },
    })
}

async function clear(userId: string) {
  await db.delete(lineConversations).where(eq(lineConversations.lineUserId, userId))
}

function clientButtons(list: { id: string; name: string }[]): QuickReplyAction[] {
  return list.map((c) => button(c.name, `client=${c.id}`, c.name))
}

async function recentClients() {
  return db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(eq(clients.status, 'active'))
    .orderBy(desc(clients.updatedAt), desc(clients.createdAt))
    .limit(CLIENT_BUTTONS)
}

function categoryPrompt(lead = '請選擇專案類別：'): LineMessage {
  return text(lead, [
    ...Object.entries(CATEGORY_LABEL).map(([value, label]) => button(label, `category=${value}`, label)),
    CANCEL,
  ])
}

function duePrompt(): LineMessage {
  return text('請選擇截止日（可略過）：', [
    { type: 'datetimepicker', label: '選擇日期', data: 'due', mode: 'date' },
    button('略過', 'skip'),
    CANCEL,
  ])
}

/** 依 id 或完整名稱找啟用中的客戶 */
async function findClient(value: string) {
  const byId = /^[0-9a-f-]{36}$/i.test(value)
  return db.query.clients.findFirst({
    where: and(eq(clients.status, 'active'), byId ? eq(clients.id, value) : eq(clients.name, value)),
  })
}

/** 開始新增：列出最近有異動的 12 位啟用中客戶 */
export async function startQuickAdd(userId: string): Promise<LineMessage[]> {
  await save(userId, 'choose_client', {})
  const list = await recentClients()
  // LINE 快速回覆最多 13 顆：客戶滿 12 位時放不下「取消」，改提示直接輸入「取消」
  const full = list.length >= CLIENT_BUTTONS
  return [
    text(
      full ? '新增專案：請選擇客戶（輸入「取消」可結束）' : '新增專案：請選擇客戶',
      [...clientButtons(list), button('輸入關鍵字搜尋', 'search'), ...(full ? [] : [CANCEL])],
    ),
  ]
}

/** 是否為快速新增流程的 postback（data 格式） */
export function isQuickAddPostback(data: string): boolean {
  return /^(add=project|client=|category=|skip$|cancel$|search$|due$)/.test(data)
}

/**
 * 處理一次互動。回傳 null 代表目前不在流程中、且這次輸入也不是開始新增
 * （交給呼叫端回主選單）。
 */
export async function handleQuickAdd(userId: string, input: QuickAddInput): Promise<LineMessage[] | null> {
  if (input.kind === 'postback' && input.data === 'add=project') return startQuickAdd(userId)

  const conv = await db.query.lineConversations.findFirst({
    where: eq(lineConversations.lineUserId, userId),
  })
  if (!conv) {
    if (input.kind === 'postback' && isQuickAddPostback(input.data)) {
      return [text('這個新增流程已經結束了，請從選單重新開始。')]
    }
    return null
  }

  if (conv.expiresAt.getTime() < Date.now()) {
    await clear(userId)
    return [text('上一次新增已逾時，請重新開始。', [button('新增專案', 'add=project')])]
  }

  if (
    (input.kind === 'postback' && input.data === 'cancel') ||
    (input.kind === 'message' && input.text.trim() === '取消')
  ) {
    await clear(userId)
    return [text('已取消，沒有建立專案。')]
  }

  switch (conv.step) {
    case 'choose_client': {
      if (input.kind === 'postback' && input.data.startsWith('client=')) {
        const client = await findClient(input.data.slice('client='.length))
        if (!client) return [text('找不到這個客戶，請重新選擇或輸入關鍵字。', [CANCEL])]
        await save(userId, 'choose_category', { clientId: client.id })
        return [categoryPrompt(`客戶：${client.name}\n請選擇專案類別：`)]
      }
      if (input.kind === 'postback' && input.data === 'search') {
        await save(userId, 'choose_client', conv.data)
        return [text('請輸入客戶名稱關鍵字：', [CANCEL])]
      }
      if (input.kind === 'message' && input.text.trim()) {
        const keyword = input.text.trim()
        const found = await db
          .select({ id: clients.id, name: clients.name })
          .from(clients)
          .where(and(eq(clients.status, 'active'), ilike(clients.name, `%${keyword.replace(/[%_\\]/g, '\\$&')}%`)))
          .orderBy(desc(clients.updatedAt))
          .limit(CLIENT_BUTTONS)
        await save(userId, 'choose_client', conv.data)
        if (found.length === 0) {
          return [text(`找不到符合的客戶「${keyword}」，請換個關鍵字。`, [CANCEL])]
        }
        return [text('請選擇客戶：', [...clientButtons(found), CANCEL])]
      }
      return [text('請點選客戶按鈕，或輸入關鍵字搜尋。', [CANCEL])]
    }

    case 'choose_category': {
      if (input.kind === 'postback' && input.data.startsWith('category=')) {
        const category = input.data.slice('category='.length)
        if (!(category in CATEGORY_LABEL)) return [categoryPrompt('請點選下方類別按鈕：')]
        await save(userId, 'input_name', { ...conv.data, category })
        return [text(`類別：${CATEGORY_LABEL[category as ProjectCategory]}\n請輸入專案名稱：`, [CANCEL])]
      }
      return [categoryPrompt('請點選下方類別按鈕：')]
    }

    case 'input_name': {
      const name = input.kind === 'message' ? input.text.trim().replace(/^"|"$/g, '').trim() : ''
      if (!name) {
        await save(userId, 'input_name', conv.data)
        return [text('請輸入專案名稱（不可空白）：', [CANCEL])]
      }
      await save(userId, 'choose_due_date', { ...conv.data, name })
      return [duePrompt()]
    }

    case 'choose_due_date': {
      let dueDate = ''
      if (input.kind === 'postback' && input.data === 'due' && input.date) dueDate = input.date
      else if (input.kind === 'postback' && input.data === 'skip') dueDate = ''
      else return [duePrompt()]

      const { clientId = '', category = '', name = '' } = conv.data
      const result = await createProject({ name, clientId, category, dueDate }, `line:${userId}`)
      if (!result.ok || !result.projectId) {
        return [text(`建立失敗：${result.error ?? '未知錯誤'}`, [CANCEL])]
      }
      await clear(userId)
      const client = await db.query.clients.findFirst({ where: eq(clients.id, clientId) })
      const due = dueDate ? `，${shortDate(dueDate)} 截止` : ''
      return [
        text(
          `已建立：${client?.name ?? ''} · ${name}（${CATEGORY_LABEL[category as ProjectCategory]}${due}）\n` +
            `${env.APP_URL}/projects/${result.projectId}`,
        ),
      ]
    }
  }
}
