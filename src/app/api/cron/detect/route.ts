import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm'

import { db } from '@/db'
import { services } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { runCronJob } from '@/lib/cron'
import { daysUntil } from '@/lib/dates'
import { checkSsl } from '@/lib/ssl'
import { lookupDomain } from '@/lib/whois'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * 自動偵測到期日（建議每週執行一次）。
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/detect"
 *
 * 網域查 WHOIS、SSL 走 TLS 握手讀憑證。
 *
 * ── 結果不直接覆蓋 expiresAt ──────────────────────────────
 * 偵測值寫進 detectedExpiresAt，與人工維護的值並存。兩者差異超過一天時
 * 介面會標示衝突，由你確認後才套用。理由很實際：WHOIS 格式各家不同，
 * 解析錯一個日期就會讓報價單在錯的時間、用錯的金額寄給客戶。
 */

/**
 * 字串看起來像不像網域／網址。
 *
 * 用來避免把「網域名稱續約」這類中文標籤送去查 WHOIS ——
 * 那會被轉成 punycode 後得到一個看不懂的錯誤訊息。
 */
function looksLikeHost(value: string): boolean {
  const text = value.trim()
  if (!text || /\s/.test(text)) return false
  return /^(https?:\/\/)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(text)
}

/** WHOIS 有查詢頻率限制，同一個網域最多每週查一次 */
const RECHECK_AFTER_DAYS = 7
const MAX_PER_RUN = 40

export async function GET(request: Request) {
  // 成功（2xx、非乾跑）後送外部監控心跳
  return runCronJob('detect', request, ({ dryRun }) => run(dryRun))
}

async function run(dryRun: boolean): Promise<Response> {

  const staleBefore = new Date(
    Date.now() - RECHECK_AFTER_DAYS * 24 * 60 * 60 * 1000,
  )

  const targets = await db.query.services.findMany({
    where: and(
      eq(services.status, 'active'),
      inArray(services.type, ['domain', 'ssl']),
      or(isNull(services.detectedAt), lt(services.detectedAt, staleBefore)),
    ),
    limit: MAX_PER_RUN,
    with: { site: true },
  })

  const results: {
    id: string
    identifier: string
    type: string
    source: 'whois' | 'tls'
    detected?: string
    current: string
    conflict?: boolean
    error?: string
  }[] = []

  const skipped: { identifier: string; reason: string }[] = []

  for (const service of targets) {
    const source = service.type === 'domain' ? 'whois' : 'tls'

    /**
     * 偵測目標的取用順序：
     *   1. 明確設定的 detectHost
     *   2. identifier 本身（僅當它看起來像網域，不是「網域名稱續約」這種標籤）
     *   3. 網站的主要網址（SSL 用得到）
     */
    const target =
      service.detectHost?.trim() ||
      (looksLikeHost(service.identifier) ? service.identifier : null) ||
      service.site.primaryUrl

    if (!target) {
      skipped.push({
        identifier: service.identifier,
        reason:
          '沒有可偵測的網域。請在服務項目填寫「偵測目標」，或在網站填寫網址',
      })
      continue
    }

    const outcome =
      service.type === 'domain'
        ? await lookupDomain(target)
        : await checkSsl(target)

    if (!outcome.ok) {
      results.push({
        id: service.id,
        identifier: service.identifier,
        type: service.type,
        source,
        current: service.expiresAt,
        error: outcome.error,
      })
      if (!dryRun) {
        await db
          .update(services)
          .set({ detectedAt: new Date(), detectError: outcome.error })
          .where(eq(services.id, service.id))
      }
      continue
    }

    // 差一天以內視為一致（各家 WHOIS 的時區標示不同）
    const diff = Math.abs(daysUntil(outcome.expiresAt, service.expiresAt))
    const conflict = diff > 1

    results.push({
      id: service.id,
      identifier: service.identifier,
      type: service.type,
      source,
      detected: outcome.expiresAt,
      current: service.expiresAt,
      conflict,
    })

    if (!dryRun) {
      await db
        .update(services)
        .set({
          detectedExpiresAt: outcome.expiresAt,
          detectSource: source,
          detectedAt: new Date(),
          detectError: null,
        })
        .where(eq(services.id, service.id))
    }
  }

  const conflicts = results.filter((r) => r.conflict).length
  const errors = results.filter((r) => r.error).length

  if (!dryRun && results.length > 0) {
    await logActivity('system', 'cron.detect', null, null, {
      checked: results.length,
      conflicts,
      errors,
    })
  }

  return Response.json({
    ok: true,
    dryRun,
    checked: results.length,
    conflicts,
    errors,
    skipped,
    /** 下次執行會再檢查這些以外的項目 */
    remaining: targets.length === MAX_PER_RUN ? '可能還有未檢查的項目' : 0,
    results,
  })
}
