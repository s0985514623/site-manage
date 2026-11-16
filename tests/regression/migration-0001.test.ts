import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'

import { testDatabaseUrl } from '../setup/test-db'

/**
 * migration 0001 的 D1：既有安裝（已有設定列）升級後維持「LINE 確認後自動寄」，
 * 全新安裝預設手動寄。用另一個 _test 資料庫，先只跑 0000、塞一列設定，再跑到最新。
 */
const MIGRATIONS = path.resolve(import.meta.dirname, '../../src/db/migrations')
const base = testDatabaseUrl()
const dbName = `${new URL(base).pathname.slice(1).replace(/_test$/, '')}_migration_test`
const url = base.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`)

async function freshDatabase() {
  const admin = postgres(base.replace(/\/[^/?]+(\?|$)/, '/postgres$1'), { max: 1, onnotice: () => {} })
  await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
  await admin.unsafe(`CREATE DATABASE "${dbName}"`)
  await admin.end()
}

/** 只保留前 n 支 migration 的暫存資料夾 */
function migrationsUpTo(n: number): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'migrations-'))
  cpSync(MIGRATIONS, dir, { recursive: true })
  const journalPath = path.join(dir, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
  journal.entries = journal.entries.slice(0, n)
  writeFileSync(journalPath, JSON.stringify(journal))
  return dir
}

const tmpDirs: string[] = []
afterAll(() => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('migration 0001', () => {
  it('既有設定升級後維持 LINE 確認後自動寄；新安裝預設手動寄', async () => {
    await freshDatabase()
    const sql = postgres(url, { max: 1, onnotice: () => {} })
    try {
      const only0000 = migrationsUpTo(1)
      tmpDirs.push(only0000)
      await migrate(drizzle(sql), { migrationsFolder: only0000 })
      await sql`INSERT INTO settings (id) VALUES (1)`

      await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS })

      const [existing] = await sql`SELECT auto_send_enabled FROM settings WHERE id = 1`
      expect(existing.auto_send_enabled).toBe(true)

      await sql`DELETE FROM settings`
      const [fresh] = await sql`INSERT INTO settings (id) VALUES (1) RETURNING auto_send_enabled`
      expect(fresh.auto_send_enabled).toBe(false)
    } finally {
      await sql.end()
    }
  })
})
