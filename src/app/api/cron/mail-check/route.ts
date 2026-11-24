import { logActivity } from '@/lib/activity'
import { runCronJob } from '@/lib/cron'
import { features } from '@/lib/env'
import { pushToOwner, text } from '@/lib/line'
import { countLinePush, linePushAllowedCritical } from '@/lib/line-quota'
import { emailLayout, escapeHtml, notifyOwner } from '@/lib/mailer'
import { checkAllMailServices } from '@/server/mail-check'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * 企業信箱檢查（每天一次）。
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/mail-check"
 *
 * 檢查所有使用中的企業信箱服務：DNS（MX／SPF／DKIM／DMARC）＋ SMTP 收信探測。
 *
 * 只在狀態「變成 fail」與「從 fail 恢復」時告警。
 * warn（例如沒有 DMARC、25 port 連不上）只顯示在網站頁，不吵 ——
 * 這類問題通常長期存在，每天提醒只會讓真正的故障被忽略。
 */
export async function GET(request: Request) {
  return runCronJob('mail-check', request, ({ dryRun }) => run(dryRun))
}

async function run(dryRun: boolean): Promise<Response> {
  const { outcomes, skipped } = await checkAllMailServices({ save: !dryRun })

  const broken = outcomes.filter((o) => o.status === 'fail' && o.previous !== 'fail')
  const recovered = outcomes.filter((o) => o.status !== 'fail' && o.previous === 'fail')

  let notified = 'none'
  if (!dryRun && (broken.length > 0 || recovered.length > 0)) {
    const sections: string[] = []
    if (broken.length > 0) {
      sections.push(
        '🔴 信箱異常\n' +
          broken
            .map((o) => {
              const problems = o.results
                .filter((r) => r.status === 'fail')
                .map((r) => `  ${r.label}：${r.detail}`)
                .join('\n')
              return `・${o.mailbox}（${o.siteName}／${o.clientName}）\n${problems}`
            })
            .join('\n'),
      )
    }
    if (recovered.length > 0) {
      sections.push('🟢 已恢復\n' + recovered.map((o) => `・${o.mailbox}（${o.siteName}）`).join('\n'))
    }
    const body = sections.join('\n\n')
    const subject =
      broken.length > 0
        ? `[信箱檢查] ${broken.length} 個信箱異常`
        : `[信箱檢查] ${recovered.length} 個信箱已恢復`

    await notifyOwner({
      subject,
      html: emailLayout(
        subject,
        `<pre style="font-family:inherit;white-space:pre-wrap;margin:0;">${escapeHtml(body)}</pre>`,
      ),
      text: body,
    })

    if (features.line && (await linePushAllowedCritical())) {
      const line = await pushToOwner([text(`【信箱檢查】\n\n${body}`)])
      if (line.ok) await countLinePush(1)
    }

    await logActivity('system', 'cron.mail_check_alert', null, null, {
      broken: broken.map((o) => o.mailbox),
      recovered: recovered.map((o) => o.mailbox),
    })
    notified = `broken=${broken.length} recovered=${recovered.length}`
  }

  return Response.json({
    ok: true,
    dryRun,
    checked: outcomes.length,
    failing: outcomes.filter((o) => o.status === 'fail').length,
    notified,
    skipped,
    results: outcomes.map((o) => ({ mailbox: o.mailbox, status: o.status, previous: o.previous })),
  })
}
