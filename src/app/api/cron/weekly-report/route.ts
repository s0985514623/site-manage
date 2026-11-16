import { runCronJob } from '@/lib/cron'
import { runWeeklyReport } from '@/server/ops/weekly-report'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 每週一 09:00 的週報。沒有待辦也推「本週無待辦」，兼作系統存活訊號。
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/weekly-report?dryRun=1"
 */
export async function GET(request: Request) {
  return runCronJob('weekly-report', request, async ({ dryRun }) => {
    const result = await runWeeklyReport(dryRun)
    return Response.json({ ok: true, ...result })
  })
}
