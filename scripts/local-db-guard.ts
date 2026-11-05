/**
 * 確認 DATABASE_URL 指向本機資料庫，否則拒絕執行。
 *
 * 只看 NODE_ENV 擋不住手動誤操作：在自己的終端機跑腳本時通常沒設 NODE_ENV，
 * 這時只要 DATABASE_URL 帶到正式環境就會直接寫進去。所以改看連線目標本身。
 *
 * 擋不住 SSH tunnel：把正式資料庫轉到 localhost 時，主機名稱看起來就是本機。
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function assertLocalDatabase(action: string) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`拒絕在 production 環境執行 ${action}`)
  }

  let host: string | null = null
  try {
    host = new URL(process.env.DATABASE_URL ?? '').hostname
  } catch {
    // 解析不了就當成不是本機，下面一起拒絕
  }

  if (!host || !LOCAL_HOSTS.has(host)) {
    throw new Error(
      `拒絕執行 ${action}：DATABASE_URL 不是本機資料庫（host: ${host ?? '無法解析'}）`,
    )
  }
}
