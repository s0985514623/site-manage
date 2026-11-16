import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { env } from '@/lib/env'
import * as schema from './schema'

/**
 * 開發模式下 Next.js 會熱重載模組，若每次都新建連線池很快就會把
 * Postgres 的連線數吃光。掛在 globalThis 上重用同一個連線。
 */
const globalForDb = globalThis as unknown as {
  __sitesupport_sql?: ReturnType<typeof postgres>
}

const client =
  globalForDb.__sitesupport_sql ??
  postgres(env.DATABASE_URL, {
    // 共用 VPS 上三個 app 共用一個 PostgreSQL，每個 app 最多 5 條連線
    max: 5,
    // 到期日欄位一律以 date 進出，連線時區固定台北避免任何隱式換算
    connection: { TimeZone: 'Asia/Taipei' },
  })

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__sitesupport_sql = client
}

export const db = drizzle(client, { schema })
export { client as sql }
export * from './schema'
