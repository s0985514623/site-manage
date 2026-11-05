/**
 * 正式環境的資料庫 migration。
 *
 * 為什麼不直接用 drizzle-kit：
 * drizzle-kit 是 devDependency，正式映像只裝 production 相依，裡面沒有它。
 * drizzle-orm 自帶的 migrator 做的事完全一樣 —— 讀 migrations 資料夾、
 * 比對 drizzle.__drizzle_migrations 表、只跑沒跑過的那幾支 —— 卻不必為了
 * 部署把整套開發工具鏈（含 esbuild）塞進映像。
 *
 * 為什麼刻意不接在 server.js 的啟動流程上：
 * migration 必須是「部署前跑一次」的獨立動作。綁在應用程式啟動時，
 * 將來只要多開一個容器就會有兩個行程同時改 schema。
 *
 * 執行（在 VPS 上）：
 *   docker compose -f docker-compose.prod.yml run --rm migrate
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const MIGRATIONS_DIR = path.join(process.cwd(), 'src', 'db', 'migrations')

const url = process.env.DATABASE_URL
if (!url) {
  console.error('✗ 缺少 DATABASE_URL')
  process.exit(1)
}

const sqlFiles = existsSync(MIGRATIONS_DIR)
  ? readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
  : []

if (sqlFiles.length === 0) {
  console.error(
    `✗ ${MIGRATIONS_DIR} 裡沒有任何 .sql\n` +
      '  請先在本機執行 npm run db:generate，並把 src/db/migrations/ 一起提交',
  )
  process.exit(1)
}

// migration 是一次性動作，單一連線就夠；max: 1 也確保 DDL 不會交錯執行
const sql = postgres(url, { max: 1, onnotice: () => {} })

try {
  console.log(`執行 migration（${sqlFiles.length} 支待比對）...`)
  await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_DIR })
  console.log('✓ migration 完成')
} catch (error) {
  console.error('✗ migration 失敗，資料庫未被改動（drizzle 以交易包住每一支）')
  console.error(`  ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
} finally {
  await sql.end()
}
