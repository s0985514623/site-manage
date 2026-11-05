import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { quotes, services } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { createApproval } from '@/lib/approvals'
import { authorizeCron, isDryRun, unauthorized } from '@/lib/cron'
import { buildItems, collectQuoteGroups, createQuoteForGroup } from '@/lib/quote-builder'
import { formatPeriod } from '@/lib/dates'
import { env, features } from '@/lib/env'
import { buildApprovalMessage } from '@/lib/quote-message'
import { pushToOwner } from '@/lib/line'
import { linePushAllowedCritical, countLinePush } from '@/lib/line-quota'
import { emailLayout, notifyOwner } from '@/lib/mailer'
import { formatMoney } from '@/lib/money'
import { quoteRecipients } from '@/server/queries'
import { getSettings } from '@/lib/settings'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * 每日擬合併報價草稿（建議台北時間 09:30，排在到期掃描之後）。
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        "$APP_URL/api/cron/quote-draft?dryRun=1"
 *
 * 乾跑會完整算出「會開哪幾張單、含哪些項目、各項期間與金額」但不寫入
 * 任何資料、不推 LINE。調整觸發天數後務必先乾跑確認。
 */
export async function GET(request: Request) {
  if (!authorizeCron(request)) return unauthorized()
  const dryRun = isDryRun(request)

  const config = await getSettings()
  const scan = await collectQuoteGroups(config)

  if (dryRun) {
    return Response.json({
      ok: true,
      dryRun: true,
      scannedAt: scan.scannedAt,
      triggerDays: scan.triggerDays,
      windowDays: scan.windowDays,
      wouldCreate: scan.groups.map((g) => ({
        client: g.clientName,
        site: g.siteName,
        anchor: g.anchor.identifier,
        anchorDate: g.anchorDate,
        anchorDaysLeft: g.anchorDays,
        currency: g.currency,
        items: buildItems(g.items).map((i) => ({
          description: i.description,
          period: formatPeriod(i.periodStart, i.periodEnd),
          amount: i.amount,
        })),
        excludedNoPrice: g.excludedNoPrice.map((s) => s.identifier),
      })),
      skipped: scan.skipped,
    })
  }

  const created: {
    quoteNo: string
    client: string
    site: string
    total: string
    pushed: string
  }[] = []
  const errors: { site: string; error: string }[] = []

  for (const group of scan.groups) {
    try {
      const quote = await createQuoteForGroup(group, config)
      const recipients = await quoteRecipients(group.clientId)

      /**
       * 沒有收件人就不推 LINE 要你確認 —— 按下確認也寄不出去，
       * 只會白白浪費一次推播額度並讓人困惑。改為留在草稿狀態，
       * 由每日彙總信提醒你先去補聯絡人 Email。
       */
      let pushed: string
      if (recipients.length === 0) {
        pushed = 'skipped: 此客戶沒有設定報價單收件人，請先補上聯絡人 Email'
      } else if (!features.lineApproval) {
        pushed = 'skipped: 尚未設定 LINE 審核，報價單留在草稿等你手動處理'
      } else if (!(await linePushAllowedCritical())) {
        pushed = 'skipped: 本月 LINE 推播額度已用盡'
      } else {
        const token = await createApproval(quote.id)
        const message = await buildApprovalMessage(quote.id, token, recipients)
        const result = await pushToOwner([message])
        if (result.ok) {
          await countLinePush(1)
          await db
            .update(quotes)
            .set({ status: 'pending_approval', linePushedAt: new Date() })
            .where(eq(quotes.id, quote.id))
          await db
            .update(services)
            .set({ renewalState: 'pending_approval' })
            .where(eq(services.currentQuoteId, quote.id))
          pushed = 'sent'
        } else {
          pushed = `failed: ${'error' in result ? result.error : 'reason' in result ? result.reason : 'unknown'}`
        }
      }

      created.push({
        quoteNo: quote.quoteNo,
        client: quote.clientName,
        site: quote.siteName,
        total: formatMoney(quote.total, quote.currency),
        pushed,
      })
    } catch (error) {
      errors.push({
        site: group.siteName,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * 沒能推到 LINE 的草稿要用 Email 補通知，否則報價單會靜靜躺在
   * 後台直到項目過期——那正是這套系統要避免的事。
   */
  const needsAttention = created.filter((c) => c.pushed !== 'sent')
  if (needsAttention.length > 0) {
    const rows = needsAttention
      .map(
        (c) =>
          `<li><strong>${c.quoteNo}</strong> ${c.client} · ${c.site}（${c.total}）<br>
           <span style="color:#b54708;font-size:13px;">${c.pushed}</span></li>`,
      )
      .join('')
    await notifyOwner({
      subject: `[網站續約] ${needsAttention.length} 張報價草稿待處理`,
      html: emailLayout(
        '報價草稿待處理',
        `<p>以下報價單已產生，但沒有透過 LINE 送出確認，需要你手動處理：</p>
         <ul style="padding-left:20px;">${rows}</ul>
         <p><a href="${env.APP_URL}/quotes">開啟報價單列表</a></p>`,
      ),
    })
  }

  if (created.length > 0 || errors.length > 0) {
    await logActivity('system', 'cron.quote_draft', null, null, {
      created: created.length,
      pushed: created.filter((c) => c.pushed === 'sent').length,
      errors: errors.length,
    })
  }

  return Response.json({
    ok: true,
    dryRun: false,
    scannedAt: scan.scannedAt,
    created,
    errors,
    skipped: scan.skipped,
  })
}
