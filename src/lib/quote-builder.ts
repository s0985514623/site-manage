import { and, asc, eq, isNull } from 'drizzle-orm'

import { db } from '@/db'
import {
  plans,
  quoteItems,
  quotes,
  services,
  sites,
  type Service,
  type Settings,
} from '@/db/schema'
import {
  CYCLE_UNIT,
  advanceByCycle,
  daysUntil,
  formatPeriod,
  formatTw,
  plusDays,
  renewalPeriodStart,
  today,
  type BillingCycle,
  type DateStr,
} from './dates'
import { SERVICE_TYPE_LABEL } from './labels'
import { computeTotals, lineAmountCents, toCents, type TaxMode } from './money'
import { nextQuoteNo } from './quote-no'
import { getSettings } from './settings'

/**
 * 合併報價的分組與計算。
 *
 * ── 核心規則 ────────────────────────────────────────────────
 * 以「網站」為單位合併。取該網站最早到期的項目作為錨點，當錨點剩餘
 * 天數 <= 觸發天數時，把錨點日往後 N 天內到期的項目全部開進同一張單。
 *
 * ── 最容易出錯、也最容易被客訴的地方 ─────────────────────────
 * 每個項目的服務期間必須「各自從它自己的到期日起算」。
 *
 *   網域 10/15 到期、主機 12/01 到期，10 月初合併成一張單寄出。
 *   若把主機的新期間也從 10/15 起算，客戶等於白白少了一個半月的主機。
 *
 * 所以 periodStart = 該項目自己 expiresAt 的「隔天」，
 *     periodEnd   = 該項目自己 expiresAt 加上「它自己的」計費週期。
 *
 * 起日取隔天是沿用你現有報價單的寫法（10/15 到期 → 10/16 ~ 隔年 10/15），
 * 舊期間到到期日當天為止，新期間自隔天接續，不會重疊到同一天。
 * 報價單上逐項標明期間，客戶對帳時一看就清楚沒被多收。
 */

export type SkipReason =
  | 'not_due' // 錨點還沒到觸發天數
  | 'no_price' // 代管項目沒設售價，開出去會是零元報價
  | 'zero_total' // 全部項目都是 0 元，沒有東西可收費
  | 'mixed_currency' // 同一張單混了不同幣別，金額無法直接相加

export type QuoteGroup = {
  siteId: string
  siteName: string
  clientId: string
  clientName: string
  clientShortName: string | null
  anchor: Service
  anchorDate: DateStr
  anchorDays: number
  /** 會開進報價單的項目（含錨點） */
  items: Service[]
  /** 因為沒設售價而被排除的項目 */
  excludedNoPrice: Service[]
  currency: string
}

export type GroupScan = {
  scannedAt: DateStr
  triggerDays: number
  windowDays: number
  groups: QuoteGroup[]
  skipped: { siteId: string; siteName: string; reason: SkipReason; detail?: string }[]
}

/**
 * 找出今天該擬報價草稿的網站。
 *
 * 只看 currentQuoteId 為空的項目：已經被某張報價單涵蓋的項目不能
 * 再被開一次，否則每天跑一次 cron 就會每天開一張新單。
 */
export async function collectQuoteGroups(
  config?: Settings,
): Promise<GroupScan> {
  const settings = config ?? (await getSettings())
  const scannedAt = today()

  const rows = await db
    .select({
      service: services,
      siteId: sites.id,
      siteName: sites.name,
      clientId: sites.clientId,
    })
    .from(services)
    .innerJoin(sites, eq(services.siteId, sites.id))
    .where(
      and(
        eq(services.isOurs, true),
        eq(services.status, 'active'),
        eq(services.renewalState, 'upcoming'),
        isNull(services.currentQuoteId),
      ),
    )
    .orderBy(asc(services.expiresAt))

  // 客戶名稱另外查，避免在上面的查詢再多 join 一層
  const clientNames = new Map<string, { name: string; shortName: string | null }>()
  const siteList = await db.query.sites.findMany({ with: { client: true } })
  for (const s of siteList)
    clientNames.set(s.id, {
      name: s.client.name,
      shortName: s.client.shortName,
    })

  const bySite = new Map<string, typeof rows>()
  for (const row of rows) {
    const list = bySite.get(row.siteId) ?? []
    list.push(row)
    bySite.set(row.siteId, list)
  }

  const groups: QuoteGroup[] = []
  const skipped: GroupScan['skipped'] = []

  for (const [siteId, list] of bySite) {
    const siteName = list[0].siteName
    // rows 已依 expiresAt 排序，所以第一筆就是錨點
    const anchor = list[0].service
    const anchorDate = anchor.expiresAt
    const anchorDays = daysUntil(anchorDate, scannedAt)

    if (anchorDays > settings.quoteTriggerDays) {
      skipped.push({ siteId, siteName, reason: 'not_due' })
      continue
    }

    const windowEnd = plusDays(anchorDate, settings.quoteWindowDays)
    const inWindow = list
      .map((r) => r.service)
      .filter((s) => s.expiresAt <= windowEnd)

    const withPrice = inWindow.filter((s) => s.priceAmount !== null)
    const excludedNoPrice = inWindow.filter((s) => s.priceAmount === null)

    if (withPrice.length === 0) {
      skipped.push({
        siteId,
        siteName,
        reason: 'no_price',
        detail: inWindow.map((s) => s.identifier).join('、'),
      })
      continue
    }

    /**
     * 混幣別直接跳過而不是硬加。把 USD 的主機費和 TWD 的網域費相加
     * 會得到一個毫無意義的數字，而那個數字會被寄到客戶信箱。
     */
    const currencies = new Set(withPrice.map((s) => s.currency))
    if (currencies.size > 1) {
      skipped.push({
        siteId,
        siteName,
        reason: 'mixed_currency',
        detail: [...currencies].join(' / '),
      })
      continue
    }

    /**
     * 全部項目都是 0 元時不開單。
     *
     * 單一項目 0 元是合理的（例如 Let's Encrypt 憑證隨服務附贈，
     * 列在報價單上讓客戶看見價值），但整張單總額為 0 就沒有意義，
     * 寄出去只會讓客戶困惑「這是要我付什麼」。
     */
    const totalCents = withPrice.reduce(
      (sum, s) => sum + toCents(s.priceAmount),
      0,
    )
    if (totalCents === 0) {
      skipped.push({
        siteId,
        siteName,
        reason: 'zero_total',
        detail: withPrice.map((s) => s.identifier).join('、'),
      })
      continue
    }

    groups.push({
      siteId,
      siteName,
      clientId: list[0].clientId,
      clientName: clientNames.get(siteId)?.name ?? '',
      clientShortName: clientNames.get(siteId)?.shortName ?? null,
      anchor,
      anchorDate,
      anchorDays,
      items: withPrice,
      excludedNoPrice,
      currency: withPrice[0].currency,
    })
  }

  return {
    scannedAt,
    triggerDays: settings.quoteTriggerDays,
    windowDays: settings.quoteWindowDays,
    groups,
    skipped,
  }
}

/* ------------------------------------------------------------------ */
/* 明細組裝                                                             */
/* ------------------------------------------------------------------ */

export type DraftItem = {
  serviceId: string
  description: string
  specNote: string | null
  periodStart: DateStr
  periodEnd: DateStr
  unit: string
  unitPrice: string
  amount: string
  sortOrder: number
}

/**
 * 把服務項目轉成報價明細。
 *
 * 期間各自起算是這裡的重點：
 *   起日 = 該項目自己到期日的隔天（不是報價單錨點日）
 *   迄日 = 起日所屬週期的結束，即舊到期日 + 一個週期
 *
 * 規格說明優先用服務項目自訂的，沒有才回退到方案範本。
 */
export function buildItems(
  items: Service[],
  specByPlanId: Map<string, string> = new Map(),
): DraftItem[] {
  return items.map((service, index) => {
    const cycle = service.billingCycle as BillingCycle
    const periodStart = renewalPeriodStart(service.expiresAt)
    const periodEnd = advanceByCycle(service.expiresAt, cycle)
    const price = service.priceAmount ?? '0'

    const specNote =
      service.specNote ??
      (service.planId ? (specByPlanId.get(service.planId) ?? null) : null)

    const period = `${SERVICE_TYPE_LABEL[service.type]}使用期間為 ${formatPeriod(periodStart, periodEnd)}`

    /**
     * 名稱欄：項目名稱 + 類型 + 續約。
     *
     * 但項目名稱本身若已經寫了「續約」（例如登記成「虛擬主機續約」），
     * 再接一次就會變成「虛擬主機續約 主機續約」，所以直接沿用原名。
     */
    const description = service.identifier.includes('續約')
      ? service.identifier
      : `${service.identifier} ${SERVICE_TYPE_LABEL[service.type]}續約`

    return {
      serviceId: service.id,
      description,
      specNote: specNote ? `${specNote}\n${period}` : period,
      periodStart,
      periodEnd,
      unit: CYCLE_UNIT[cycle],
      unitPrice: Number(price).toFixed(2),
      amount: (lineAmountCents(price, 1) / 100).toFixed(2),
      sortOrder: index,
    }
  })
}

/** 取出所有方案範本的規格說明，供 buildItems 回退使用 */
export async function loadPlanSpecs(): Promise<Map<string, string>> {
  const rows = await db.select({ id: plans.id, specNote: plans.specNote }).from(plans)
  return new Map(rows.map((r) => [r.id, r.specNote]))
}

/**
 * 報價有效期限。
 *
 * 一般情況取「今天 + 設定天數」與「錨點到期日」較早者：報價單不該在
 * 項目已經過期之後還顯示有效，那會讓客戶以為還來得及。
 *
 * 但錨點若「已經逾期」，上面的規則會算出一個位於過去的日期 ——
 * 寄出一張有效期限早於開立日的報價單既失禮又會讓客戶困惑。
 * 這種情況改用完整的有效天數：東西已經在寬限期了，重點是讓客戶
 * 盡快付款，而不是把期限訂在過去。
 */
export function computeValidUntil(
  anchorDate: DateStr,
  validDays: number,
  from: DateStr = today(),
): DateStr {
  const byDays = plusDays(from, validDays)
  if (anchorDate <= from) return byDays
  return byDays < anchorDate ? byDays : anchorDate
}

/* ------------------------------------------------------------------ */
/* 寫入                                                                 */
/* ------------------------------------------------------------------ */

export type CreatedQuote = {
  id: string
  quoteNo: string
  siteId: string
  siteName: string
  clientName: string
  total: string
  currency: string
  itemCount: number
}

/**
 * 建立一張合併報價單。
 *
 * 整個流程包在同一個交易裡：產生編號、寫入報價單與明細、把服務項目
 * 標記為已被涵蓋。任何一步失敗都要整批回滾，否則會出現
 * 「服務已標記為 drafted 但報價單不存在」的孤兒狀態，
 * 那些項目就再也不會被開進任何一張單，等於靜默漏掉續約。
 */
export async function createQuoteForGroup(
  group: QuoteGroup,
  config: Settings,
  planSpecs?: Map<string, string>,
): Promise<CreatedQuote> {
  const issueDate = today()
  const items = buildItems(group.items, planSpecs ?? (await loadPlanSpecs()))
  const totals = computeTotals(
    items.map((i) => toCents(i.amount)),
    config.defaultTaxMode as TaxMode,
    config.defaultTaxRate,
  )

  /**
   * 匯款期限以「錨點到期日」為準，而不是報價單有效期限：
   * 客戶真正該在意的是最早那一項什麼時候斷線。
   */
  const paymentNote = (
    config.quotePaymentNote ??
    '請於到期日{date}前完成匯款，以避免網域或主機遭服務商釋出影響使用權利'
  ).replace('{date}', formatTw(group.anchorDate))

  return db.transaction(async (tx) => {
    const quoteNo = await nextQuoteNo(tx, issueDate)

    const [quote] = await tx
      .insert(quotes)
      .values({
        quoteNo,
        // 專案名稱優先用客戶簡稱：全名放進來會太長
        projectName: `${group.clientShortName || group.clientName}${group.siteName}續約`,
        deliveryMethod: [...new Set(group.items.map((s) => SERVICE_TYPE_LABEL[s.type]))]
          .join('、')
          .concat('續約'),
        paymentNote,
        clientId: group.clientId,
        siteId: group.siteId,
        status: 'draft',
        anchorServiceId: group.anchor.id,
        anchorDate: group.anchorDate,
        issueDate,
        validUntil: computeValidUntil(
          group.anchorDate,
          config.quoteValidDays,
          issueDate,
        ),
        currency: group.currency,
        taxMode: config.defaultTaxMode,
        taxRate: config.defaultTaxRate,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
        terms: config.quoteTerms,
      })
      .returning()

    await tx.insert(quoteItems).values(
      items.map((i) => ({
        quoteId: quote.id,
        serviceId: i.serviceId,
        description: i.description,
        specNote: i.specNote,
        periodStart: i.periodStart,
        periodEnd: i.periodEnd,
        quantity: '1',
        unit: i.unit,
        unitPrice: i.unitPrice,
        amount: i.amount,
        sortOrder: i.sortOrder,
      })),
    )

    for (const service of group.items) {
      await tx
        .update(services)
        .set({
          currentQuoteId: quote.id,
          renewalState: 'drafted',
          updatedAt: new Date(),
        })
        .where(eq(services.id, service.id))
    }

    return {
      id: quote.id,
      quoteNo,
      siteId: group.siteId,
      siteName: group.siteName,
      clientName: group.clientName,
      total: totals.total,
      currency: group.currency,
      itemCount: items.length,
    }
  })
}

/**
 * 解除報價單對服務項目的佔用。
 * 你在 LINE 上按取消、或報價單逾期時呼叫，讓這些項目下個週期
 * 能重新被擬進新的草稿。
 */
export async function releaseServices(quoteId: string): Promise<void> {
  await db
    .update(services)
    .set({
      currentQuoteId: null,
      renewalState: 'upcoming',
      updatedAt: new Date(),
    })
    .where(eq(services.currentQuoteId, quoteId))
}
