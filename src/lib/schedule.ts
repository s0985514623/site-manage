/**
 * 排程任務的純邏輯：內建任務清單、下次執行時間計算、顯示文字。
 *
 * 不 import env / db：設定頁的 client component 也會用到這裡的常數與描述。
 *
 * 時間一律以台北時間（UTC+8，無日光節約）解讀。
 * 用固定位移而不是 date-fns-tz：計算「下一個 09:30」只需要牆上時鐘，
 * 固定位移的結果可預期，也好寫測試。
 */

export const SCHEDULE_FREQUENCIES = ['interval', 'daily', 'weekly', 'monthly'] as const
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number]

export const SCHEDULE_FREQUENCY_LABEL: Record<ScheduleFrequency, string> = {
  interval: '每隔幾分鐘',
  daily: '每天',
  weekly: '每週',
  monthly: '每月',
}

/** 間隔都能整除 1440，每天的執行時刻固定（例：每 15 分鐘 = 每小時 :00 :15 :30 :45） */
export const INTERVAL_CHOICES = [5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 720] as const

export const WEEKDAY_LABEL = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'] as const

export const SCHEDULED_TASK_KINDS = ['builtin', 'line_message', 'http_request'] as const
export type ScheduledTaskKind = (typeof SCHEDULED_TASK_KINDS)[number]

export const SCHEDULED_TASK_KIND_LABEL: Record<ScheduledTaskKind, string> = {
  builtin: '系統任務',
  line_message: 'LINE 提醒',
  http_request: '呼叫網址',
}

/** 內建任務 = /api/cron/<名稱>。名稱也是外部監控心跳的 job 名稱，不可改 */
export const BUILTIN_JOBS = [
  'gcal-sync',
  'detect',
  'expiry-scan',
  'quote-draft',
  'quote-followup',
  'payment-followup',
  'weekly-report',
  'uptime',
  'mail-check',
] as const
export type BuiltinJob = (typeof BUILTIN_JOBS)[number]

export const BUILTIN_JOB_LABEL: Record<BuiltinJob, string> = {
  'gcal-sync': 'Google 日曆對帳',
  detect: 'WHOIS／TLS 到期偵測',
  'expiry-scan': '到期掃描與提醒',
  'quote-draft': '擬定續約報價草稿',
  'quote-followup': '報價未回覆追蹤',
  'payment-followup': '未收款追蹤',
  'weekly-report': 'LINE 每週週報',
  uptime: '網站存活監控',
  'mail-check': '企業信箱檢查',
}

export const HTTP_METHODS = ['GET', 'POST'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

export type Schedule = {
  frequency: ScheduleFrequency
  intervalMinutes?: number | null
  /** 'HH:MM'（台北時間） */
  timeOfDay?: string | null
  /** 0 = 週日 … 6 = 週六 */
  weekday?: number | null
  /** 1–31；該月沒有這一天時（例：2 月 30 日）改在當月最後一天執行 */
  dayOfMonth?: number | null
}

const OFFSET_MS = 8 * 60 * 60 * 1000

/** 台北牆上時鐘：用 UTC getter 讀取位移後的 Date */
function toWall(date: Date): Date {
  return new Date(date.getTime() + OFFSET_MS)
}

function fromWall(y: number, m: number, d: number, minutes: number): Date {
  return new Date(Date.UTC(y, m, d, 0, minutes) - OFFSET_MS)
}

export function parseTimeOfDay(value: string | null | undefined): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value ?? '')
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
}

/**
 * 嚴格晚於 after 的下一次執行時間。
 * 參數不完整時回傳 null（呼叫端應先用 validateSchedule 擋下）。
 */
export function nextRunAfter(schedule: Schedule, after: Date): Date | null {
  const wall = toWall(after)
  const y = wall.getUTCFullYear()
  const m = wall.getUTCMonth()
  const d = wall.getUTCDate()
  const nowMinutes = wall.getUTCHours() * 60 + wall.getUTCMinutes()
  const afterMinute = (t: Date) => t.getTime() > after.getTime()

  if (schedule.frequency === 'interval') {
    const n = schedule.intervalMinutes ?? 0
    if (!INTERVAL_CHOICES.includes(n as (typeof INTERVAL_CHOICES)[number])) return null
    const next = (Math.floor(nowMinutes / n) + 1) * n
    return fromWall(y, m, d, next) // next 可能等於 1440 → Date.UTC 自動進位到隔天 00:00
  }

  const time = parseTimeOfDay(schedule.timeOfDay)
  if (time === null) return null

  if (schedule.frequency === 'daily') {
    const today = fromWall(y, m, d, time)
    return afterMinute(today) ? today : fromWall(y, m, d + 1, time)
  }

  if (schedule.frequency === 'weekly') {
    const target = schedule.weekday
    if (target == null || target < 0 || target > 6) return null
    for (let i = 0; i <= 7; i++) {
      const candidate = fromWall(y, m, d + i, time)
      if (toWall(candidate).getUTCDay() === target && afterMinute(candidate)) return candidate
    }
    return null
  }

  const dom = schedule.dayOfMonth
  if (dom == null || dom < 1 || dom > 31) return null
  for (let i = 0; i <= 2; i++) {
    const cy = y + Math.floor((m + i) / 12)
    const cm = (m + i) % 12
    const candidate = fromWall(cy, cm, Math.min(dom, daysInMonth(cy, cm)), time)
    if (afterMinute(candidate)) return candidate
  }
  return null
}

/** 驗證排程參數，回傳錯誤訊息或 null */
export function validateSchedule(schedule: Schedule): string | null {
  switch (schedule.frequency) {
    case 'interval':
      return INTERVAL_CHOICES.includes(schedule.intervalMinutes as (typeof INTERVAL_CHOICES)[number])
        ? null
        : '請選擇間隔分鐘數'
    case 'daily':
      return parseTimeOfDay(schedule.timeOfDay) === null ? '請填寫執行時間（HH:MM）' : null
    case 'weekly':
      if (parseTimeOfDay(schedule.timeOfDay) === null) return '請填寫執行時間（HH:MM）'
      return schedule.weekday != null && schedule.weekday >= 0 && schedule.weekday <= 6
        ? null
        : '請選擇星期幾'
    case 'monthly':
      if (parseTimeOfDay(schedule.timeOfDay) === null) return '請填寫執行時間（HH:MM）'
      return schedule.dayOfMonth != null && schedule.dayOfMonth >= 1 && schedule.dayOfMonth <= 31
        ? null
        : '請選擇每月幾號（1–31）'
    default:
      return '請選擇執行頻率'
  }
}

/** 顯示用：「每天 09:30」「每週一 08:00」「每月 1 號 10:00」「每 15 分鐘」 */
export function describeSchedule(schedule: Schedule): string {
  switch (schedule.frequency) {
    case 'interval': {
      const n = schedule.intervalMinutes ?? 0
      return n >= 60 && n % 60 === 0 ? `每 ${n / 60} 小時` : `每 ${n} 分鐘`
    }
    case 'daily':
      return `每天 ${schedule.timeOfDay}`
    case 'weekly':
      return `每${WEEKDAY_LABEL[schedule.weekday ?? 0]} ${schedule.timeOfDay}`
    case 'monthly':
      return `每月 ${schedule.dayOfMonth} 號 ${schedule.timeOfDay}${
        (schedule.dayOfMonth ?? 0) > 28 ? '（該月沒有這天就在月底）' : ''
      }`
  }
}

/** 顯示用：台北時間 2026/11/19 09:30 */
export function formatRunTime(date: Date): string {
  const w = toWall(date)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${w.getUTCFullYear()}/${p(w.getUTCMonth() + 1)}/${p(w.getUTCDate())} ${p(w.getUTCHours())}:${p(w.getUTCMinutes())}`
}
