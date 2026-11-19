import { authorizeCron, unauthorized } from '@/lib/cron'
import { runDueTasks } from '@/server/ops/scheduled-tasks'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * 排程派發器：VPS 每分鐘呼叫一次（site-manager-cron-tick.timer）。
 *
 * 依 scheduled_tasks 表（設定頁可調整）執行到期的任務。
 * 心跳由各內建任務自己的路由外殼送出，tick 本身不送——
 * tick 停擺時，所有內建任務的心跳都會斷，外部監控照樣會告警。
 */
export async function GET(request: Request) {
  if (!authorizeCron(request)) return unauthorized()
  const result = await runDueTasks()
  return Response.json({ ok: true, ...result })
}
