import { config } from 'dotenv'

/**
 * 測試資料庫連線字串。只讀 TEST_DATABASE_URL，絕不沿用 DATABASE_URL。
 *
 * 兩道防線（R3）：主機必須是本機、資料庫名稱必須以 _test 結尾。
 * 名稱檢查擋的是「把開發資料庫填進 TEST_DATABASE_URL」——測試每次都會清空所有表。
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function checkTestDatabaseUrl(raw: string | undefined): string {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('拒絕在 production 環境執行測試')
  }
  if (!raw) {
    throw new Error(
      '缺少 TEST_DATABASE_URL。請在 .env.local 加上，例如：\n' +
        '  TEST_DATABASE_URL="postgresql://site_support:local_dev_only@localhost:5433/site_support_test"',
    )
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('TEST_DATABASE_URL 無法解析')
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`拒絕執行測試：TEST_DATABASE_URL 不是本機資料庫（host: ${url.hostname}）`)
  }
  const dbName = url.pathname.replace(/^\//, '')
  if (!dbName.endsWith('_test')) {
    throw new Error(`拒絕執行測試：資料庫名稱必須以 _test 結尾（目前：${dbName || '空白'}）`)
  }
  return raw
}

export function testDatabaseUrl(): string {
  config({ path: '.env.local', quiet: true })
  return checkTestDatabaseUrl(process.env.TEST_DATABASE_URL)
}
