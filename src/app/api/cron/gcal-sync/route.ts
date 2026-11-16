import { logActivity } from '@/lib/activity'
import { runCronJob } from '@/lib/cron'
import { env } from '@/lib/env'
import { calendarStatus } from '@/lib/gcal'
import { emailLayout, escapeHtml, notifyOwner } from '@/lib/mailer'
import { reconcileCalendar } from '@/server/gcal-sync'
import { reconcileProjectCalendar } from '@/server/projects/calendar'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Google Calendar 每日對帳（建議每日執行一次）。
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/gcal-sync"
 *
 * 逐筆存檔時的同步可能因為網路或配額失敗，只靠那一次會讓日曆悄悄失準。
 * 這裡把所有使用中的項目重跑一次，並清掉已終止項目殘留的事件。
 *
 * ── 授權失效會主動通知 ────────────────────────────────
 * OAuth 應用程式維持「測試中」狀態時 refresh token 每 7 天過期。
 * 偵測到失效就寄信提醒你重新授權，不讓同步默默停擺。
 */
export async function GET(request: Request) {
  // 成功（2xx、非乾跑）後送外部監控心跳
  return runCronJob('gcal-sync', request, () => run())
}

async function run(): Promise<Response> {

  const status = await calendarStatus()
  if (!status.authorized) {
    return Response.json({
      ok: true,
      skipped: '尚未授權 Google Calendar',
    })
  }

  const result = await reconcileCalendar()
  // 「專案管理」日曆：補上逐筆同步失敗、還沒有事件的專案與里程碑
  const projects = result.reauthRequired ? { synced: 0 } : await reconcileProjectCalendar()

  if (result.reauthRequired) {
    const subject = '[網站續約] Google Calendar 授權已失效'
    await notifyOwner({
      subject,
      html: emailLayout(
        subject,
        `<p>行事曆同步已停止，因為 Google 授權失效。</p>
<p>若 OAuth 應用程式仍是「測試中」狀態，refresh token 每 7 天就會過期。
把應用程式發布到正式狀態可以解除這個限制。</p>
<p style="margin-top:20px;">
  <a href="${env.APP_URL}/settings"
     style="display:inline-block;padding:10px 16px;border-radius:8px;background:#1f6feb;color:#fff;text-decoration:none;">
    前往設定頁重新授權
  </a>
</p>`,
      ),
      text: `Google Calendar 授權已失效，行事曆同步已停止。\n請到 ${env.APP_URL}/settings 重新授權。`,
    })
  } else if (result.failed > 0) {
    const subject = `[網站續約] 行事曆同步有 ${result.failed} 筆失敗`
    await notifyOwner({
      subject,
      html: emailLayout(
        subject,
        `<ul style="padding-left:20px;">${result.errors
          .map(
            (e) =>
              `<li>${escapeHtml(e.identifier)}<br><span style="color:#b54708;font-size:13px;">${escapeHtml(e.error)}</span></li>`,
          )
          .join('')}</ul>`,
      ),
    })
  }

  await logActivity('system', 'cron.gcal_sync', null, null, {
    synced: result.synced,
    removed: result.removed,
    failed: result.failed,
    reauthRequired: result.reauthRequired,
  })

  return Response.json({ ok: true, ...result, projectEventsSynced: projects.synced })
}
