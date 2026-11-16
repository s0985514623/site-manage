import { afterAll, afterEach, beforeEach, vi } from 'vitest'

import { fakeFetch, fakeNet } from '../fakes/network'
import { 今天是, 恢復時鐘 } from '../support/clock'
import { testDatabaseUrl } from './test-db'

/**
 * 每個測試檔載入前執行。環境變數必須在 import 任何 src/ 模組之前設好：
 * src/lib/env.ts 在模組載入當下就驗證（R4）。
 */
const url = testDatabaseUrl()
Object.assign(process.env, {
  DATABASE_URL: url,
  APP_URL: 'https://site.test',
  AUTH_SECRET: 'test-only-auth-secret-0000000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  CRON_SECRET: 'test-only-cron-secret-000000000',
  ALLOWED_EMAILS: 'owner@example.com',
  RESEND_API_KEY: 're_test',
  MAIL_FROM: '報價通知 <notice@site.test>',
  NOTIFY_TO: 'owner@example.com',
  LINE_CHANNEL_ACCESS_TOKEN: 'line-test-token',
  LINE_CHANNEL_SECRET: 'line-test-secret',
  LINE_ADMIN_USER_ID: 'Uadmin000000000000000000000000000',
  HEARTBEAT_URL: 'https://heartbeat.test/ping',
  HEARTBEAT_TOKEN: 'heartbeat-test-token',
  TZ: 'Asia/Taipei',
})

/** Server Action 會呼叫 revalidatePath；測試環境沒有 Next 的快取，換成空函式 */
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

/** 登入：一律視為白名單中的管理者 */
vi.mock('@/auth', () => ({
  requireUser: vi.fn(async () => 'owner@example.com'),
  currentUserEmail: vi.fn(async () => 'owner@example.com'),
  auth: vi.fn(async () => ({ user: { email: 'owner@example.com' } })),
  CALENDAR_SCOPE: 'https://www.googleapis.com/auth/calendar',
}))

vi.stubGlobal('fetch', fakeFetch)

beforeEach(async () => {
  fakeNet.reset()
  今天是('2026-11-16')
  const { sql } = await import('@/db')
  // 清空所有業務資料表（保留 drizzle 的 migration 紀錄）
  const tables = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  if (tables.length > 0) {
    await sql.unsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
    )
  }
})

afterEach(() => {
  恢復時鐘()
})

afterAll(async () => {
  const { sql } = await import('@/db')
  await sql.end({ timeout: 5 })
})
