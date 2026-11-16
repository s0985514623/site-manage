import { pingHeartbeat } from './heartbeat'
import { env } from './env'
import { safeEqual } from './crypto'

/**
 * /api/cron/* 端點的驗證。
 *
 * 這些端點沒有登入保護（排程服務無法帶 session），所以改用共享密鑰。
 * 用定時比較避免以回應時間推測密鑰。
 *
 * 支援兩種帶法：
 *   Authorization: Bearer <CRON_SECRET>   一般排程服務
 *   x-cron-secret: <CRON_SECRET>          某些 PaaS 不允許自訂 Authorization
 */
export function authorizeCron(request: Request): boolean {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const header = request.headers.get('x-cron-secret')
  const provided = bearer || header
  if (!provided) return false
  return safeEqual(provided, env.CRON_SECRET)
}

export function unauthorized(): Response {
  return Response.json({ error: 'unauthorized' }, { status: 401 })
}

/**
 * 乾跑模式：計算出該做什麼但不實際寄信、不寫入紀錄。
 * 部署後第一次執行、或調整過觸發天數時，先乾跑確認名單正確再真的送出。
 */
export function isDryRun(request: Request): boolean {
  const value = new URL(request.url).searchParams.get('dryRun')
  return value === '1' || value === 'true'
}

/**
 * 排程端點的共用外殼：驗證密鑰 → 執行 → 成功（2xx 且非乾跑）才送心跳。
 * 心跳失敗不影響回應（見 heartbeat.ts）。
 */
export async function runCronJob(
  name: string,
  request: Request,
  handler: (ctx: { dryRun: boolean }) => Promise<Response>,
): Promise<Response> {
  if (!authorizeCron(request)) return unauthorized()
  const dryRun = isDryRun(request)
  const response = await handler({ dryRun })
  if (response.ok && !dryRun) await pingHeartbeat(name)
  return response
}
