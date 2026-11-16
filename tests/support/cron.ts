/**
 * 以排程器身分呼叫 /api/cron/<name>（帶正確的 CRON_SECRET）。
 * 路由要明確列出：vite 無法解析 `@/app/api/cron/${name}/route` 這種動態路徑。
 */
const ROUTES = {
  'quote-draft': () => import('@/app/api/cron/quote-draft/route'),
  'expiry-scan': () => import('@/app/api/cron/expiry-scan/route'),
  'quote-followup': () => import('@/app/api/cron/quote-followup/route'),
  'payment-followup': () => import('@/app/api/cron/payment-followup/route'),
} as const

export type CronName = keyof typeof ROUTES

export async function 排程執行(name: CronName, opts: { dryRun?: boolean } = {}) {
  const { GET } = await ROUTES[name]()
  const url = `https://site.test/api/cron/${name}${opts.dryRun ? '?dryRun=1' : ''}`
  const response = await GET(
    new Request(url, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }),
  )
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}
