import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// Next.js 會自動載入 .env.local，但 drizzle-kit CLI 不會
config({ path: '.env.local', quiet: true })

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
