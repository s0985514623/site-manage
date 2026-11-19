import { and, eq, isNotNull, lt } from 'drizzle-orm'

import { db } from '@/db'
import { sites, uptimeChecks } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { runCronJob } from '@/lib/cron'
import { features } from '@/lib/env'
import { pushToOwner, text } from '@/lib/line'
import { linePushAllowedCritical, countLinePush } from '@/lib/line-quota'
import { emailLayout, escapeHtml, notifyOwner } from '@/lib/mailer'
import { checkUptime } from '@/lib/uptime'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * 網站存活監控（每 15 分鐘執行）。
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/uptime"
 *
 * 只檢查有開啟監控且填了網址的網站。
 *
 * ── 連續兩次失敗才告警 ─────────────────────────────────
 * 單次失敗太常見（主機重啟、網路瞬斷、CDN 抖動），每次都通知的話
 * 很快就會被當成雜訊而整個忽略掉，真的掛掉時反而沒人看。
 */

/** 連續失敗達到這個次數才發告警 */
const ALERT_AFTER = 2
/** 檢查紀錄保留天數 */
const KEEP_DAYS = 30

export async function GET(request: Request) {
  // 成功（2xx、非乾跑）後送外部監控心跳
  return runCronJob('uptime', request, ({ dryRun }) => run(dryRun))
}

async function run(dryRun: boolean): Promise<Response> {

  const targets = await db.query.sites.findMany({
    where: and(eq(sites.monitorEnabled, true), isNotNull(sites.primaryUrl)),
    with: { client: true },
  })

  const down: { name: string; client: string; url: string; error: string }[] = []
  const recovered: { name: string; client: string; url: string }[] = []
  const results: {
    site: string
    ok: boolean
    statusCode: number | null
    responseMs: number
    failures: number
    error?: string | null
  }[] = []

  for (const site of targets) {
    const url = site.primaryUrl!
    const result = await checkUptime(url)

    const failures = result.ok ? 0 : site.consecutiveFailures + 1
    results.push({
      site: site.name,
      ok: result.ok,
      statusCode: result.statusCode,
      responseMs: result.responseMs,
      failures,
      error: result.error,
    })

    if (dryRun) continue

    await db.insert(uptimeChecks).values({
      siteId: site.id,
      ok: result.ok,
      statusCode: result.statusCode,
      responseMs: result.responseMs,
      error: result.error,
    })

    await db
      .update(sites)
      .set({ consecutiveFailures: failures, lastUptimeOk: result.ok })
      .where(eq(sites.id, site.id))

    // 剛好達到門檻才告警一次，之後持續失敗不重複吵
    if (!result.ok && failures === ALERT_AFTER) {
      down.push({
        name: site.name,
        client: site.client.name,
        url,
        error: result.error ?? '無回應',
      })
    }
    // 之前處於告警狀態，現在恢復了
    if (result.ok && site.consecutiveFailures >= ALERT_AFTER) {
      recovered.push({ name: site.name, client: site.client.name, url })
    }
  }

  /* ---------------- 告警 ---------------- */
  let notified = 'none'
  if (!dryRun && (down.length > 0 || recovered.length > 0)) {
    const lines: string[] = []
    if (down.length > 0) {
      lines.push(
        `🔴 無法連線（連續 ${ALERT_AFTER} 次）\n` +
          down
            .map((d) => `・${d.name}（${d.client}）\n  ${d.url}\n  ${d.error}`)
            .join('\n'),
      )
    }
    if (recovered.length > 0) {
      lines.push(
        `🟢 已恢復\n` +
          recovered.map((r) => `・${r.name}（${r.client}）`).join('\n'),
      )
    }
    const body = lines.join('\n\n')

    const subject =
      down.length > 0
        ? `[網站監控] ${down.length} 個網站無法連線`
        : `[網站監控] ${recovered.length} 個網站已恢復`

    await notifyOwner({
      subject,
      html: emailLayout(
        subject,
        `<pre style="font-family:inherit;white-space:pre-wrap;margin:0;">${escapeHtml(body)}</pre>`,
      ),
      text: body,
    })

    if (features.line && (await linePushAllowedCritical())) {
      const line = await pushToOwner([text(`【網站監控】\n\n${body}`)])
      if (line.ok) await countLinePush(1)
    }

    await logActivity('system', 'cron.uptime_alert', null, null, {
      down: down.map((d) => d.name),
      recovered: recovered.map((r) => r.name),
    })
    notified = `down=${down.length} recovered=${recovered.length}`
  }

  /* ---------------- 清理舊紀錄 ---------------- */
  if (!dryRun) {
    const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000)
    await db.delete(uptimeChecks).where(lt(uptimeChecks.checkedAt, cutoff))
  }

  return Response.json({
    ok: true,
    dryRun,
    checked: results.length,
    failing: results.filter((r) => !r.ok).length,
    notified,
    results,
  })
}
