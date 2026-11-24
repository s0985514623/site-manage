import { and, asc, desc, eq, isNull, lte } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { scheduledTasks, type ScheduledTask } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { env } from '@/lib/env'
import { pushToOwner, text } from '@/lib/line'
import { countLinePush, linePushAllowed } from '@/lib/line-quota'
import { emailLayout, escapeHtml, notifyOwner } from '@/lib/mailer'
import {
  BUILTIN_JOBS,
  HTTP_METHODS,
  SCHEDULED_TASK_KINDS,
  SCHEDULE_FREQUENCIES,
  nextRunAfter,
  validateSchedule,
  type BuiltinJob,
  type Schedule,
} from '@/lib/schedule'
import { fail, formError, success, type ActionState } from '@/server/actions/helpers'

/**
 * 排程任務：設定頁可調整時間、新增 LINE 提醒／呼叫網址／內建任務的額外時段。
 *
 * 執行端只有一支每分鐘的 systemd timer → /api/cron/tick → runDueTasks()。
 */

/** 內建任務 = 既有的 /api/cron/<job> 路由。明確列出才能被 bundler 靜態解析 */
const BUILTIN_ROUTES: Record<BuiltinJob, () => Promise<{ GET: (request: Request) => Promise<Response> }>> = {
  'gcal-sync': () => import('@/app/api/cron/gcal-sync/route'),
  detect: () => import('@/app/api/cron/detect/route'),
  'expiry-scan': () => import('@/app/api/cron/expiry-scan/route'),
  'quote-draft': () => import('@/app/api/cron/quote-draft/route'),
  'quote-followup': () => import('@/app/api/cron/quote-followup/route'),
  'payment-followup': () => import('@/app/api/cron/payment-followup/route'),
  'weekly-report': () => import('@/app/api/cron/weekly-report/route'),
  uptime: () => import('@/app/api/cron/uptime/route'),
  'mail-check': () => import('@/app/api/cron/mail-check/route'),
}

const HTTP_TIMEOUT_MS = 30_000
const MESSAGE_LIMIT = 500

type RunResult = { ok: boolean; message: string }

function scheduleOf(task: ScheduledTask): Schedule {
  return {
    frequency: task.frequency,
    intervalMinutes: task.intervalMinutes,
    timeOfDay: task.timeOfDay,
    weekday: task.weekday,
    dayOfMonth: task.dayOfMonth,
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/* ------------------------------------------------------------------ */
/* 執行單一任務                                                          */
/* ------------------------------------------------------------------ */

async function runBuiltin(job: string): Promise<RunResult> {
  const load = BUILTIN_ROUTES[job as BuiltinJob]
  if (!load) return { ok: false, message: `未知的系統任務：${job}` }
  const { GET } = await load()
  // 走原本的路由外殼：驗證密鑰、成功後送外部監控心跳，行為與 systemd 直接呼叫時相同
  const response = await GET(
    new Request(`${env.APP_URL}/api/cron/${job}`, {
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    }),
  )
  const body = (await response.text()).slice(0, MESSAGE_LIMIT)
  return { ok: response.ok, message: `HTTP ${response.status} ${body}`.trim() }
}

/** LINE 提醒：額度不足或推播失敗時改寄 Email，提醒不會無聲消失 */
async function runLineMessage(name: string, message: string): Promise<RunResult> {
  if (await linePushAllowed()) {
    const result = await pushToOwner([text(message)])
    if (result.ok) {
      await countLinePush(1)
      return { ok: true, message: '已推送 LINE' }
    }
  }
  const mail = await notifyOwner({
    subject: `[排程提醒] ${name}`,
    html: emailLayout(name, `<p style="white-space:pre-wrap;">${escapeHtml(message)}</p>`),
    text: message,
  })
  if (mail.ok) return { ok: true, message: 'LINE 無法推送，已改寄 Email' }
  return { ok: false, message: `LINE 與 Email 都失敗：${'error' in mail ? mail.error : mail.reason}` }
}

async function runHttpRequest(url: string, method: string): Promise<RunResult> {
  try {
    const response = await fetch(url, {
      method,
      redirect: 'follow',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    return { ok: response.ok, message: `HTTP ${response.status}` }
  } catch (error) {
    return { ok: false, message: errorText(error).slice(0, MESSAGE_LIMIT) }
  }
}

async function execute(task: ScheduledTask): Promise<RunResult> {
  try {
    switch (task.kind) {
      case 'builtin':
        return await runBuiltin(task.job ?? '')
      case 'line_message':
        return await runLineMessage(task.name, task.message ?? '')
      case 'http_request':
        return await runHttpRequest(task.url ?? '', task.method ?? 'GET')
    }
  } catch (error) {
    return { ok: false, message: errorText(error).slice(0, MESSAGE_LIMIT) }
  }
}

async function record(task: ScheduledTask, at: Date, result: RunResult) {
  await db
    .update(scheduledTasks)
    .set({ lastRunAt: at, lastOk: result.ok, lastMessage: result.message })
    .where(eq(scheduledTasks.id, task.id))
}

/* ------------------------------------------------------------------ */
/* tick：每分鐘執行到期的任務                                            */
/* ------------------------------------------------------------------ */

export async function runDueTasks(now = new Date()) {
  // 1. 待排定（剛建立、剛從停用改回啟用、migration 種下）：只算下次時間，不補跑
  const unscheduled = await db.query.scheduledTasks.findMany({
    where: and(eq(scheduledTasks.enabled, true), isNull(scheduledTasks.nextRunAt)),
  })
  for (const task of unscheduled) {
    await db
      .update(scheduledTasks)
      .set({ nextRunAt: nextRunAfter(scheduleOf(task), now) })
      .where(and(eq(scheduledTasks.id, task.id), isNull(scheduledTasks.nextRunAt)))
  }

  // 2. 到期的任務：先把 next_run_at 推到下一次（條件式更新 = 搶佔），搶到的才執行。
  //    兩個 tick 重疊時同一個任務只會跑一次；錯過多次（例如停機）只補跑一次。
  const due = await db.query.scheduledTasks.findMany({
    where: and(eq(scheduledTasks.enabled, true), lte(scheduledTasks.nextRunAt, now)),
    orderBy: [asc(scheduledTasks.nextRunAt)],
  })
  const claimed: ScheduledTask[] = []
  for (const task of due) {
    const [row] = await db
      .update(scheduledTasks)
      .set({ nextRunAt: nextRunAfter(scheduleOf(task), now) })
      .where(and(eq(scheduledTasks.id, task.id), eq(scheduledTasks.nextRunAt, task.nextRunAt!)))
      .returning()
    if (row) claimed.push(task)
  }

  // 3. 並行執行：慢的任務（WHOIS 偵測可達數分鐘）不會拖住同一分鐘的其他任務
  const results = await Promise.all(
    claimed.map(async (task) => {
      const result = await execute(task)
      await record(task, now, result)
      return { id: task.id, name: task.name, ...result }
    }),
  )

  return { scheduled: unscheduled.length, ran: results }
}

/* ------------------------------------------------------------------ */
/* 設定頁：新增／編輯／刪除／立即執行                                     */
/* ------------------------------------------------------------------ */

const optionalInt = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : Number(v)))
  .pipe(z.number().int().nullable())

const inputSchema = z.object({
  id: z.string().trim(),
  name: z.string().trim().min(1, '請填寫任務名稱').max(100, '任務名稱最多 100 字'),
  kind: z.enum(SCHEDULED_TASK_KINDS, { message: '請選擇任務類型' }),
  job: z.string().trim(),
  message: z.string().trim().max(2000, '提醒內容最多 2000 字'),
  url: z.string().trim(),
  method: z.string().trim(),
  frequency: z.enum(SCHEDULE_FREQUENCIES, { message: '請選擇執行頻率' }),
  intervalMinutes: optionalInt,
  timeOfDay: z.string().trim(),
  weekday: optionalInt,
  dayOfMonth: optionalInt,
  enabled: z.boolean(),
})

export type ScheduledTaskInput = Partial<Record<keyof z.input<typeof inputSchema>, string | boolean>>

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export async function saveScheduledTask(raw: ScheduledTaskInput, actor: string): Promise<ActionState> {
  const parsed = inputSchema.safeParse({
    id: '',
    job: '',
    message: '',
    url: '',
    method: 'GET',
    intervalMinutes: '',
    timeOfDay: '',
    weekday: '',
    dayOfMonth: '',
    enabled: true,
    ...raw,
  })
  if (!parsed.success) return formError(parsed.error)
  const d = parsed.data

  const existing = d.id ? await db.query.scheduledTasks.findFirst({ where: eq(scheduledTasks.id, d.id) }) : undefined
  if (d.id && !existing) return fail('NOT_FOUND', '找不到這個排程任務')

  // 系統任務只能改名稱、時間與啟用狀態；種類與對應的路由固定
  const kind = existing?.system ? existing.kind : d.kind
  const job = existing?.system ? existing.job : d.job

  const schedule: Schedule = {
    frequency: d.frequency,
    intervalMinutes: d.frequency === 'interval' ? d.intervalMinutes : null,
    timeOfDay: d.frequency === 'interval' ? null : d.timeOfDay,
    weekday: d.frequency === 'weekly' ? d.weekday : null,
    dayOfMonth: d.frequency === 'monthly' ? d.dayOfMonth : null,
  }
  const scheduleError = validateSchedule(schedule)
  if (scheduleError) return fail('INVALID_ARGUMENT', scheduleError)

  if (kind === 'builtin' && !BUILTIN_JOBS.includes(job as BuiltinJob)) {
    return fail('INVALID_ARGUMENT', '請選擇要執行的系統任務')
  }
  if (kind === 'line_message' && !d.message) return fail('INVALID_ARGUMENT', '請填寫提醒內容')
  if (kind === 'http_request') {
    if (!isHttpUrl(d.url)) return fail('INVALID_ARGUMENT', '網址需以 http:// 或 https:// 開頭')
    if (!HTTP_METHODS.includes(d.method as (typeof HTTP_METHODS)[number])) {
      return fail('INVALID_ARGUMENT', '請選擇 GET 或 POST')
    }
  }

  const values = {
    name: d.name,
    kind,
    job: kind === 'builtin' ? job : null,
    message: kind === 'line_message' ? d.message : null,
    url: kind === 'http_request' ? d.url : null,
    method: kind === 'http_request' ? d.method : null,
    ...schedule,
    enabled: d.enabled,
    // 存檔當下就算好下次時間，畫面立即可見；停用的任務不排
    nextRunAt: d.enabled ? nextRunAfter(schedule, new Date()) : null,
    updatedAt: new Date(),
  }

  if (existing) {
    await db.update(scheduledTasks).set(values).where(eq(scheduledTasks.id, existing.id))
    await logActivity(actor, 'scheduled_task.updated', 'scheduled_task', existing.id, { name: d.name })
  } else {
    const [row] = await db.insert(scheduledTasks).values(values).returning({ id: scheduledTasks.id })
    await logActivity(actor, 'scheduled_task.created', 'scheduled_task', row.id, { name: d.name, kind })
  }
  return success
}

export async function deleteScheduledTask(id: string, actor: string): Promise<ActionState> {
  const task = id ? await db.query.scheduledTasks.findFirst({ where: eq(scheduledTasks.id, id) }) : undefined
  if (!task) return fail('NOT_FOUND', '找不到這個排程任務')
  if (task.system) {
    return fail('SYSTEM_TASK_NOT_DELETABLE', '系統內建的排程不能刪除，不需要時請改為停用')
  }
  await db.delete(scheduledTasks).where(eq(scheduledTasks.id, id))
  await logActivity(actor, 'scheduled_task.deleted', 'scheduled_task', id, { name: task.name })
  return success
}

/** 立即執行一次（不影響下次排定時間），結果寫進「上次執行」 */
export async function runScheduledTaskNow(id: string, actor: string): Promise<ActionState> {
  const task = id ? await db.query.scheduledTasks.findFirst({ where: eq(scheduledTasks.id, id) }) : undefined
  if (!task) return fail('NOT_FOUND', '找不到這個排程任務')
  const at = new Date()
  const result = await execute(task)
  await record(task, at, result)
  await logActivity(actor, 'scheduled_task.run', 'scheduled_task', id, { ok: result.ok })
  return result.ok ? success : { error: `執行失敗：${result.message}` }
}

export async function listScheduledTasks() {
  return db.query.scheduledTasks.findMany({
    // 依一天中的時間排序，間隔型（沒有時間）排最後
    orderBy: [desc(scheduledTasks.system), asc(scheduledTasks.timeOfDay), asc(scheduledTasks.createdAt)],
  })
}
