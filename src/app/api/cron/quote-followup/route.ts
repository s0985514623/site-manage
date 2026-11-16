import { runCronJob } from '@/lib/cron'
import { runQuoteFollowup } from '@/server/quotes/followup'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 報價未回覆追蹤（每日 09:40）。寄出滿 N 天仍未回覆就提醒，之後每 N 天再提醒。
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/quote-followup?dryRun=1"
 */
export async function GET(request: Request) {
  return runCronJob('quote-followup', request, async ({ dryRun }) => {
    const result = await runQuoteFollowup(dryRun)
    return Response.json({ ok: true, dryRun, ...result })
  })
}
