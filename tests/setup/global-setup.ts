import path from 'node:path'

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

import { testDatabaseUrl } from './test-db'

/**
 * 整個測試執行一次：確認測試庫存在 → 清空 → 跑 src/db/migrations。
 * 用 migration 而不是 db:push 建 schema，順便驗證 migration 本身能跑。
 */
export default async function setup() {
  const url = testDatabaseUrl()
  const dbName = new URL(url).pathname.slice(1)

  // 測試庫不存在就建立（連到同一台的 postgres 維護庫）
  const admin = postgres(url.replace(/\/[^/?]+(\?|$)/, '/postgres$1'), { max: 1, onnotice: () => {} })
  try {
    const [row] = await admin`SELECT 1 AS ok FROM pg_database WHERE datname = ${dbName}`
    if (!row) await admin.unsafe(`CREATE DATABASE "${dbName}"`)
  } finally {
    await admin.end()
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;')
    await migrate(drizzle(sql), {
      migrationsFolder: path.resolve(__dirname, '../../src/db/migrations'),
    })
  } finally {
    await sql.end()
  }
}
