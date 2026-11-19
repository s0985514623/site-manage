import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '@/db'
import { scheduledTasks } from '@/db/schema'
import { deleteScheduledTask, runDueTasks, saveScheduledTask } from '@/server/ops/scheduled-tasks'

import { fakeNet } from '../../fakes/network'
import { 今天是 } from '../../support/clock'
import { LINE本月推播額度已用完 } from '../../support/given'

const OWNER = 'owner@example.com'

/** 台北時間 'YYYY-MM-DD HH:MM' → Date */
const at = (value: string) => new Date(`${value.replace(' ', 'T')}:00+08:00`)

type TaskRow = typeof scheduledTasks.$inferInsert

async function 有任務(values: Omit<TaskRow, 'nextRunAt'> & { nextRunAt?: string | null }) {
  const [row] = await db
    .insert(scheduledTasks)
    .values({ ...values, nextRunAt: values.nextRunAt ? at(values.nextRunAt) : null })
    .returning()
  return row
}

const 任務 = async (name: string) => {
  const row = await db.query.scheduledTasks.findFirst({ where: eq(scheduledTasks.name, name) })
  if (!row) throw new Error(`找不到任務 ${name}`)
  return row
}

const LINE提醒 = (name: string, message: string, timeOfDay = '09:00', nextRunAt?: string) =>
  有任務({ name, kind: 'line_message', message, frequency: 'daily', timeOfDay, nextRunAt })

describe('管理排程任務', () => {
  it.each([
    { kind: 'line_message', detail: '提醒內容空白', input: { message: '', timeOfDay: '09:00' } },
    { kind: 'http_request', detail: '網址為 ftp://hook.test', input: { url: 'ftp://hook.test', timeOfDay: '09:00' } },
    { kind: 'line_message', detail: '時間為 25:00', input: { message: '嗨', timeOfDay: '25:00' } },
    { kind: 'builtin', detail: '系統任務為 unknown', input: { job: 'unknown', timeOfDay: '09:00' } },
  ])('欄位不完整時新增失敗：$detail', async ({ kind, input }) => {
    今天是('2026-11-16', '10:00')
    const r = await saveScheduledTask({ name: '測試', kind, frequency: 'daily', ...input }, OWNER)
    expect(r.violationType).toBe('INVALID_ARGUMENT')
    expect(await db.query.scheduledTasks.findMany()).toHaveLength(0)
  })

  it('新增每天的 LINE 提醒後排定下次執行時間', async () => {
    今天是('2026-11-16', '10:00')
    const r = await saveScheduledTask(
      { name: '提醒對帳', kind: 'line_message', message: '記得對帳', frequency: 'daily', timeOfDay: '09:00', enabled: true },
      OWNER,
    )
    expect(r.ok).toBe(true)
    expect((await 任務('提醒對帳')).nextRunAt).toEqual(at('2026-11-17 09:00'))
  })

  it('每月 31 號的任務在小月改於月底執行', async () => {
    今天是('2027-02-01', '10:00')
    const r = await saveScheduledTask(
      { name: '月底結帳', kind: 'line_message', message: '結帳', frequency: 'monthly', dayOfMonth: '31', timeOfDay: '18:00' },
      OWNER,
    )
    expect(r.ok).toBe(true)
    expect((await 任務('月底結帳')).nextRunAt).toEqual(at('2027-02-28 18:00'))
  })

  it('調整系統任務的時間只改時間不改任務內容', async () => {
    今天是('2026-11-16', '10:00')
    const task = await 有任務({ name: '到期掃描與提醒', kind: 'builtin', job: 'expiry-scan', frequency: 'daily', timeOfDay: '09:00', system: true })
    const r = await saveScheduledTask(
      { id: task.id, name: '到期掃描與提醒', kind: 'line_message', message: '亂改', frequency: 'daily', timeOfDay: '15:00', enabled: true },
      OWNER,
    )
    expect(r.ok).toBe(true)
    const row = await 任務('到期掃描與提醒')
    expect(row.nextRunAt).toEqual(at('2026-11-16 15:00'))
    expect(row).toMatchObject({ kind: 'builtin', job: 'expiry-scan', message: null, system: true, timeOfDay: '15:00' })
  })

  it('刪除系統任務失敗', async () => {
    const task = await 有任務({ name: '到期掃描與提醒', kind: 'builtin', job: 'expiry-scan', frequency: 'daily', timeOfDay: '09:00', system: true })
    const r = await deleteScheduledTask(task.id, OWNER)
    expect(r.violationType).toBe('SYSTEM_TASK_NOT_DELETABLE')
    expect(await db.query.scheduledTasks.findMany()).toHaveLength(1)
  })

  it('刪除自訂任務成功', async () => {
    const task = await LINE提醒('提醒對帳', '記得對帳')
    const r = await deleteScheduledTask(task.id, OWNER)
    expect(r.ok).toBe(true)
    expect(await db.query.scheduledTasks.findMany()).toHaveLength(0)
  })

  it('到期的 LINE 提醒推送給管理者並排定下一次', async () => {
    今天是('2026-11-16', '10:00')
    await LINE提醒('提醒對帳', '記得對帳', '09:00', '2026-11-16 09:00')
    await runDueTasks()
    expect(fakeNet.lineTexts()).toEqual(['記得對帳'])
    const row = await 任務('提醒對帳')
    expect(row.lastOk).toBe(true)
    expect(row.nextRunAt).toEqual(at('2026-11-17 09:00'))
  })

  it('未到期與已停用的任務不執行', async () => {
    今天是('2026-11-16', '10:00')
    await LINE提醒('下午提醒', '下午', '15:00', '2026-11-16 15:00')
    await 有任務({ name: '舊提醒', kind: 'line_message', message: '舊', frequency: 'daily', timeOfDay: '09:00', enabled: false, nextRunAt: '2026-11-16 09:00' })
    await runDueTasks()
    expect(fakeNet.calls('line')).toHaveLength(0)
  })

  it('停機錯過多次只補跑一次', async () => {
    今天是('2026-11-16', '10:00')
    await 有任務({ name: '存活檢查', kind: 'http_request', url: 'https://hook.test/ping', method: 'GET', frequency: 'interval', intervalMinutes: 15, nextRunAt: '2026-11-16 08:00' })
    await runDueTasks()
    expect(fakeNet.calls('hook').map((c) => c.url)).toEqual(['https://hook.test/ping'])
    expect((await 任務('存活檢查')).nextRunAt).toEqual(at('2026-11-16 10:15'))
  })

  it('尚未排定的任務第一次 tick 只排定不執行', async () => {
    今天是('2026-11-16', '10:00')
    await 有任務({ name: 'LINE 每週週報', kind: 'builtin', job: 'weekly-report', frequency: 'weekly', weekday: 1, timeOfDay: '09:00', system: true })
    await runDueTasks()
    expect(fakeNet.calls('line')).toHaveLength(0)
    expect((await 任務('LINE 每週週報')).nextRunAt).toEqual(at('2026-11-23 09:00'))
  })

  it('同一時間兩次 tick 只執行一次', async () => {
    今天是('2026-11-16', '10:00')
    await LINE提醒('提醒對帳', '記得對帳', '09:00', '2026-11-16 09:00')
    await Promise.all([runDueTasks(), runDueTasks()])
    expect(fakeNet.lineTexts()).toEqual(['記得對帳'])
  })

  it('呼叫網址失敗時記錄失敗原因', async () => {
    今天是('2026-11-16', '10:00')
    await 有任務({ name: '觸發 wp-cron', kind: 'http_request', url: 'https://hook.test/wp-cron.php', method: 'POST', frequency: 'daily', timeOfDay: '09:00', nextRunAt: '2026-11-16 09:00' })
    fakeNet.fail('hook')
    await runDueTasks()
    expect(fakeNet.calls('hook')[0].method).toBe('POST')
    const row = await 任務('觸發 wp-cron')
    expect(row.lastOk).toBe(false)
    expect(row.lastMessage).toContain('HTTP 500')
  })

  it('內建任務由 tick 執行並送出心跳', async () => {
    今天是('2026-11-16', '10:00')
    await 有任務({ name: '網站存活監控', kind: 'builtin', job: 'uptime', frequency: 'interval', intervalMinutes: 15, system: true, nextRunAt: '2026-11-16 10:00' })
    const { GET } = await import('@/app/api/cron/tick/route')
    const response = await GET(new Request('https://site.test/api/cron/tick', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }))
    expect(response.status).toBe(200)
    expect((await 任務('網站存活監控')).lastOk).toBe(true)
    expect(fakeNet.calls('heartbeat').map((p) => new URL(p.url).searchParams.get('job'))).toEqual(['uptime'])
  })

  it('LINE 額度用完時提醒改寄 Email', async () => {
    今天是('2026-11-16', '10:00')
    await LINE本月推播額度已用完()
    await LINE提醒('提醒對帳', '記得對帳', '09:00', '2026-11-16 09:00')
    await runDueTasks()
    expect(fakeNet.calls('line')).toHaveLength(0)
    expect(fakeNet.mails().map((m) => m.subject)).toEqual([expect.stringContaining('提醒對帳')])
  })

  it('tick 密鑰錯誤時回 401', async () => {
    const { GET } = await import('@/app/api/cron/tick/route')
    const response = await GET(new Request('https://site.test/api/cron/tick', { headers: { authorization: 'Bearer wrong' } }))
    expect(response.status).toBe(401)
  })
})
