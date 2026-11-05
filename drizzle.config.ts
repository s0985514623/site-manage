import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

import { assertLocalDatabase } from './scripts/local-db-guard'

// Next.js 會自動載入 .env.local，但 drizzle-kit CLI 不會
config({ path: '.env.local', quiet: true })

// push 會直接把資料庫改成跟 schema 一樣，可能刪欄位。正式環境一律走 migration。
// 放在這裡而不是 npm script，連 npx drizzle-kit push 也擋得到。
if (process.argv.includes('push')) {
  assertLocalDatabase('drizzle-kit push')
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  casing: 'snake_case',
  verbose: true,
  strict: true,
})
