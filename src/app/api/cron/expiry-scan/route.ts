import { runCronJob } from '@/lib/cron'
import { env, features } from '@/lib/env'
import { logActivity } from '@/lib/activity'
import { pushToOwner, text } from '@/lib/line'
import { emailLayout, notifyOwner } from '@/lib/mailer'
import { countLinePush, linePushAllowed } from '@/lib/line-quota'
import {
  buildEmailBody,
  buildEmailSubject,
  buildEmailText,
  buildLineText,
  collectNotices,
  recordNotifications,
} from '@/server/expiry-scan'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 每日到期掃描（建議台北時間 09:00 執行）。
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        "$APP_URL/api/cron/expiry-scan"
 *
 * 加上 ?dryRun=1 可以只看結果不寄送，調整觸發天數後用來確認名單。
 */
export async function GET(request: Request) {
  // 成功（2xx、非乾跑）後送外部監控心跳
  return runCronJob('expiry-scan', request, ({ dryRun }) => run(dryRun))
}

async function run(dryRun: boolean): Promise<Response> {

  const emailScan = await collectNotices('email')

  if (emailScan.notices.length === 0) {
    // 沒有異動就完全不通知，避免每天一封「沒事發生」把人訓練成忽略通知
    return Response.json({
      ok: true,
      dryRun,
      scannedAt: emailScan.scannedAt,
      totalActive: emailScan.totalActive,
      sent: false,
      reason:
        emailScan.skippedAlreadySent > 0
          ? '今天已通知過'
          : '沒有項目達到提醒門檻',
      skippedAlreadySent: emailScan.skippedAlreadySent,
    })
  }

  const subject = buildEmailSubject(emailScan.notices)

  if (dryRun) {
    return Response.json({
      ok: true,
      dryRun: true,
      scannedAt: emailScan.scannedAt,
      totalActive: emailScan.totalActive,
      subject,
      wouldNotify: emailScan.notices.map((n) => ({
        identifier: n.service.identifier,
        client: n.service.clientName,
        site: n.service.siteName,
        expiresAt: n.service.expiresAt,
        days: n.days,
        level: n.level,
        urgency: n.urgency,
        isOurs: n.service.isOurs,
      })),
      skippedAlreadySent: emailScan.skippedAlreadySent,
      linePreview: buildLineText(emailScan.notices, env.APP_URL),
    })
  }

  /* --------------------------- Email --------------------------- */
  const mail = await notifyOwner({
    subject,
    html: emailLayout(
      subject,
      buildEmailBody(emailScan.notices, env.APP_URL),
    ),
    text: buildEmailText(emailScan.notices),
  })

  if (!('skipped' in mail && mail.skipped)) {
    await recordNotifications(
      emailScan.notices,
      'email',
      emailScan.scannedAt,
      mail.ok,
      mail.ok ? undefined : 'error' in mail ? mail.error : undefined,
    )
  }

  /* --------------------------- LINE ---------------------------- */
  let lineOutcome: string
  const lineScan = await collectNotices('line')

  if (!features.line) {
    lineOutcome = 'skipped: 尚未設定 LINE'
  } else if (lineScan.notices.length === 0) {
    lineOutcome = 'skipped: 今天已推播過'
  } else if (!(await linePushAllowed())) {
    // 額度快用完時只靠 Email，不要在月底把額度耗盡導致報價確認推不出去
    lineOutcome = 'skipped: 本月 LINE 推播額度不足，改以 Email 通知'
  } else {
    const line = await pushToOwner([
      text(buildLineText(lineScan.notices, env.APP_URL)),
    ])
    if (line.ok) await countLinePush(1)
    await recordNotifications(
      lineScan.notices,
      'line',
      lineScan.scannedAt,
      line.ok,
      line.ok ? undefined : 'error' in line ? line.error : undefined,
    )
    lineOutcome = line.ok
      ? 'sent'
      : `failed: ${'error' in line ? line.error : 'reason' in line ? line.reason : 'unknown'}`
  }

  await logActivity('system', 'cron.expiry_scan', null, null, {
    noticeCount: emailScan.notices.length,
    email: mail.ok ? 'sent' : 'skipped' in mail && mail.skipped ? mail.reason : 'failed',
    line: lineOutcome,
  })

  return Response.json({
    ok: true,
    dryRun: false,
    scannedAt: emailScan.scannedAt,
    totalActive: emailScan.totalActive,
    noticeCount: emailScan.notices.length,
    skippedAlreadySent: emailScan.skippedAlreadySent,
    email: mail,
    line: lineOutcome,
  })
}
