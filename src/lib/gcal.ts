import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { oauthTokens, settings } from '@/db/schema'
import { decrypt, encrypt } from './crypto'
import { advanceByCycle, formatTw, type DateStr } from './dates'
import { env } from './env'
import { SERVICE_TYPE_LABEL } from './labels'
import { formatMoney } from './money'
import { getSettings } from './settings'

/**
 * Google Calendar 同步。
 *
 * 直接打 REST API 而不用 googleapis 套件：需要的只有四個端點
 * （換權杖、建立日曆、建立／更新事件、刪除事件），引入整包 SDK
 * 會為了這點功能多拖進上百 MB 的相依。
 *
 * ── 授權方式 ────────────────────────────────────────────
 * 登入本身刻意不要求 Calendar 權限（敏感範圍會觸發 Google 驗證要求），
 * 改由設定頁單獨授權一次，refresh token 加密存在 oauth_tokens。
 *
 * ⚠️ OAuth 應用程式維持「測試中」狀態時 refresh token 只有 7 天壽命。
 * 失效時這裡會回報明確錯誤並寫入 lastError，由 cron 通知你重新授權 ——
 * 絕不靜默失敗，否則你會以為日曆是最新的。
 */

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://www.googleapis.com/calendar/v3'
const CALENDAR_NAME = '網站到期管理'

/** 存取權杖有效一小時，快取起來避免每次操作都去換 */
let cachedToken: { value: string; expiresAt: number } | null = null

export type GcalError =
  | { kind: 'not_configured'; message: string }
  | { kind: 'reauth_required'; message: string }
  | { kind: 'api_error'; message: string }

export class GcalFailure extends Error {
  constructor(readonly detail: GcalError) {
    super(detail.message)
  }
}

/* ------------------------------------------------------------------ */
/* 授權                                                                 */
/* ------------------------------------------------------------------ */

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.AUTH_GOOGLE_ID,
    redirect_uri: `${env.APP_URL}/api/google/calendar/callback`,
    response_type: 'code',
    scope: CALENDAR_SCOPE,
    // 這兩個參數缺一就拿不到 refresh token，離線同步就不可能
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

/** 用授權碼換取 refresh token 並加密存起來 */
export async function exchangeCode(code: string): Promise<void> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.AUTH_GOOGLE_ID,
      client_secret: env.AUTH_GOOGLE_SECRET,
      redirect_uri: `${env.APP_URL}/api/google/calendar/callback`,
      grant_type: 'authorization_code',
    }),
  })

  const data = (await response.json()) as {
    refresh_token?: string
    access_token?: string
    scope?: string
    error?: string
    error_description?: string
  }

  if (!response.ok || !data.refresh_token) {
    throw new GcalFailure({
      kind: 'api_error',
      message:
        data.error_description ??
        data.error ??
        '未取得 refresh token。請確認授權時有出現同意畫面（access_type=offline 且 prompt=consent）',
    })
  }

  // 取使用者 email 只是為了在設定頁顯示「目前授權給哪個帳號」
  let accountEmail = 'unknown'
  if (data.access_token) {
    try {
      const info = await fetch(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        { headers: { authorization: `Bearer ${data.access_token}` } },
      )
      const json = (await info.json()) as { email?: string }
      if (json.email) accountEmail = json.email
    } catch {
      // 拿不到 email 不影響同步本身
    }
  }

  const box = encrypt(data.refresh_token)
  await db
    .insert(oauthTokens)
    .values({
      provider: 'google',
      accountEmail,
      refreshTokenEncrypted: box.ciphertext,
      refreshTokenIv: box.iv,
      refreshTokenTag: box.tag,
      scope: data.scope ?? CALENDAR_SCOPE,
      lastError: null,
      lastRefreshedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: oauthTokens.provider,
      set: {
        accountEmail,
        refreshTokenEncrypted: box.ciphertext,
        refreshTokenIv: box.iv,
        refreshTokenTag: box.tag,
        scope: data.scope ?? CALENDAR_SCOPE,
        lastError: null,
        lastRefreshedAt: new Date(),
        updatedAt: new Date(),
      },
    })

  cachedToken = null
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value
  }

  const row = await db.query.oauthTokens.findFirst({
    where: eq(oauthTokens.provider, 'google'),
  })
  if (!row) {
    throw new GcalFailure({
      kind: 'not_configured',
      message: '尚未授權 Google Calendar，請到設定頁完成授權',
    })
  }

  const refreshToken = decrypt({
    ciphertext: row.refreshTokenEncrypted,
    iv: row.refreshTokenIv,
    tag: row.refreshTokenTag,
  })

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.AUTH_GOOGLE_ID,
      client_secret: env.AUTH_GOOGLE_SECRET,
      grant_type: 'refresh_token',
    }),
  })

  const data = (await response.json()) as {
    access_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }

  if (!response.ok || !data.access_token) {
    const message =
      data.error === 'invalid_grant'
        ? 'Google 授權已失效，需要重新授權。' +
          '若 OAuth 應用程式仍是「測試中」狀態，refresh token 每 7 天就會過期；' +
          '把應用程式發布到正式狀態可以解除這個限制。'
        : (data.error_description ?? data.error ?? '無法換取存取權杖')

    await db
      .update(oauthTokens)
      .set({ lastError: message, updatedAt: new Date() })
      .where(eq(oauthTokens.provider, 'google'))

    throw new GcalFailure({
      kind: data.error === 'invalid_grant' ? 'reauth_required' : 'api_error',
      message,
    })
  }

  await db
    .update(oauthTokens)
    .set({ lastError: null, lastRefreshedAt: new Date() })
    .where(eq(oauthTokens.provider, 'google'))

  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  }
  return cachedToken.value
}

async function call<T>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const token = await accessToken()
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
  })

  // 事件已不存在：視為成功，本來就是要讓它消失
  if (response.status === 404 || response.status === 410) return null
  if (response.status === 204) return null

  const text = await response.text()
  if (!response.ok) {
    throw new GcalFailure({
      kind: 'api_error',
      message: `Google Calendar API ${response.status}: ${text.slice(0, 300)}`,
    })
  }
  return text ? (JSON.parse(text) as T) : null
}

/* ------------------------------------------------------------------ */
/* 日曆                                                                 */
/* ------------------------------------------------------------------ */

/** 取得專屬日曆，沒有就建一個。回傳日曆 id */
export async function ensureCalendar(): Promise<string> {
  const config = await getSettings()
  if (config.gcalCalendarId) {
    // 確認日曆還在（可能被手動刪掉）
    const existing = await call<{ id: string }>(
      `/calendars/${encodeURIComponent(config.gcalCalendarId)}`,
    )
    if (existing) return config.gcalCalendarId
  }

  const created = await call<{ id: string }>('/calendars', {
    method: 'POST',
    body: JSON.stringify({
      summary: CALENDAR_NAME,
      description:
        '由網站續約管理系統自動維護。手動修改的內容會在下次同步時被覆蓋。',
      timeZone: 'Asia/Taipei',
    }),
  })
  if (!created?.id) {
    throw new GcalFailure({ kind: 'api_error', message: '建立日曆失敗' })
  }

  await db
    .update(settings)
    .set({ gcalCalendarId: created.id, updatedAt: new Date() })
    .where(eq(settings.id, 1))

  return created.id
}

/* ------------------------------------------------------------------ */
/* 事件                                                                 */
/* ------------------------------------------------------------------ */

export type EventInput = {
  serviceId: string
  clientName: string
  siteName: string
  siteId: string
  type: keyof typeof SERVICE_TYPE_LABEL
  identifier: string
  expiresAt: DateStr
  billingCycle: string
  provider: string | null
  priceAmount: string | null
  currency: string
  isOurs: boolean
}

function buildEvent(input: EventInput) {
  const typeLabel = SERVICE_TYPE_LABEL[input.type]
  const owner = input.isOurs ? '我方代管' : '客戶自管'
  const price =
    input.isOurs && input.priceAmount
      ? formatMoney(input.priceAmount, input.currency)
      : '—'

  return {
    summary: `【到期】${input.clientName} · ${typeLabel} · ${input.identifier}`,
    description: [
      `客戶：${input.clientName}`,
      `網站：${input.siteName}`,
      `項目：${typeLabel} ${input.identifier}`,
      `供應商：${input.provider ?? '—'}`,
      `歸屬：${owner}`,
      `續約售價：${price}`,
      `續約後到期日：${formatTw(advanceByCycle(input.expiresAt, input.billingCycle as never))}`,
      '',
      `後台：${env.APP_URL}/sites/${input.siteId}`,
    ].join('\n'),
    // 全天事件：end.date 是「不含」的，所以要加一天
    start: { date: input.expiresAt },
    end: { date: addOneDay(input.expiresAt) },
    reminders: {
      useDefault: false,
      /**
       * Google Calendar 的提醒上限是 40320 分鐘（28 天），
       * 所以 90／60 天那幾段仍由系統的 Email 與 LINE 負責，
       * 日曆只補上臨近到期的短期提醒。
       */
      overrides: [
        { method: 'popup', minutes: 14 * 24 * 60 },
        { method: 'popup', minutes: 3 * 24 * 60 },
      ],
    },
    // 讓對帳時能認出哪些事件是本系統建立的
    extendedProperties: {
      private: { siteSupportServiceId: input.serviceId },
    },
    transparency: 'transparent', // 不佔用忙碌時段
  }
}

function addOneDay(date: DateStr): DateStr {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** 建立或更新事件，回傳事件 id */
export async function upsertEvent(
  input: EventInput,
  existingEventId: string | null,
): Promise<string> {
  const calendarId = await ensureCalendar()
  const body = buildEvent(input)
  const cal = encodeURIComponent(calendarId)

  if (existingEventId) {
    const updated = await call<{ id: string }>(
      `/calendars/${cal}/events/${encodeURIComponent(existingEventId)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    )
    // 事件被手動刪掉的話 call 回傳 null，往下重建一個
    if (updated?.id) return updated.id
  }

  const created = await call<{ id: string }>(`/calendars/${cal}/events`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!created?.id) {
    throw new GcalFailure({ kind: 'api_error', message: '建立事件失敗' })
  }
  return created.id
}

export async function deleteEvent(eventId: string): Promise<void> {
  const config = await getSettings()
  if (!config.gcalCalendarId) return
  await call(
    `/calendars/${encodeURIComponent(config.gcalCalendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE' },
  )
}

/** 目前的授權狀態，供設定頁顯示 */
export async function calendarStatus() {
  const [row, config] = await Promise.all([
    db.query.oauthTokens.findFirst({
      where: eq(oauthTokens.provider, 'google'),
    }),
    getSettings(),
  ])

  return {
    authorized: Boolean(row),
    accountEmail: row?.accountEmail ?? null,
    calendarId: config.gcalCalendarId,
    lastError: row?.lastError ?? null,
    lastRefreshedAt: row?.lastRefreshedAt ?? null,
  }
}
