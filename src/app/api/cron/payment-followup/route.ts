import { runCronJob } from '@/lib/cron'
import { runPaymentFollowup } from '@/server/quotes/payment'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 未收款追蹤（每日 09:45）。客戶已同意但還沒登記收款的報價單：
 * 續約報價自錨點到期日前 7 天起、專案報價自同意後 14 天起提醒，之後每 3 天。
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/payment-followup?dryRun=1"
 */
export async function GET(request: Request) {
  return runCronJob('payment-followup', request, async ({ dryRun }) => {
    const result = await runPaymentFollowup(dryRun)
    return Response.json({ ok: true, dryRun, ...result })
  })
}
