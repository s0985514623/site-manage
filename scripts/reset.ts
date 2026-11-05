import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

/**
 * 清空所有業務資料（保留 settings）。
 * 僅供開發使用 —— 正式環境跑這個會刪光客戶資料。
 *
 * 執行：npm run db:reset
 */

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('拒絕在 production 環境執行 db:reset')
  }

  const { sql } = await import('../src/db')

  // 依 FK 相依順序由葉往根刪；quotes 的 FK 是 restrict，必須先於 clients
  await sql`TRUNCATE TABLE
    activity_logs,
    uptime_checks,
    notifications,
    approvals,
    credentials,
    quote_items,
    quotes,
    services,
    sites,
    contacts,
    clients
    RESTART IDENTITY CASCADE`

  console.log('已清空所有業務資料（settings 保留）')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
