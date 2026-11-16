import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { plans, projects, quoteItems, quotes } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { plusDays, today } from '@/lib/dates'
import { computeTotals, fromCents, lineAmountCents, toCents, type TaxMode } from '@/lib/money'
import { nextQuoteNo } from '@/lib/quote-no'
import { getSettings } from '@/lib/settings'
import { fail, formError, type ActionState } from '@/server/actions/helpers'

/**
 * 從專案產生報價草稿，沿用既有報價單 / PDF / 寄送流程。
 *
 * 與續約報價的差異：項目由管理者手動輸入（可從方案範本帶入規格說明），
 * 沒有到期錨點，網站可以是空的（新網站專案還沒有網站）。
 * 寄送仍依寄送模式：手動模式在報價單頁按「寄出」，自動模式由 LINE 確認。
 */

const itemSchema = z.object({
  description: z.string().trim().min(1, '請填寫項目說明'),
  quantity: z
    .string()
    .trim()
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, '數量必須大於 0'),
  unit: z.string().trim().min(1).default('式'),
  unitPrice: z
    .string()
    .trim()
    .min(1, '請填寫單價')
    .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, '單價不可為負數'),
  planId: z.string().trim().optional(),
})

export type ProjectQuoteItemInput = {
  description: string
  quantity: string
  unit?: string
  unitPrice: string
  /** 從方案範本帶入：規格說明取範本內容 */
  planId?: string
}

export async function createProjectQuote(
  projectId: string,
  items: ProjectQuoteItemInput[],
  actor: string,
): Promise<ActionState & { quoteId?: string }> {
  const planRows = await db
    .select({ id: plans.id, name: plans.name, specNote: plans.specNote, priceAmount: plans.priceAmount })
    .from(plans)
  const planOf = new Map(planRows.map((p) => [p.id, p]))
  const specOf = new Map(planRows.map((p) => [p.id, p.specNote]))

  // 選了方案範本但說明 / 單價留空時，帶入範本的名稱與售價（之後可再調整）
  const filled = (items ?? []).map((i) => {
    const plan = i.planId ? planOf.get(i.planId) : undefined
    return {
      ...i,
      description: i.description?.trim() ? i.description : (plan?.name ?? ''),
      unitPrice: i.unitPrice?.trim() ? i.unitPrice : (plan?.priceAmount ?? ''),
      quantity: i.quantity?.trim() ? i.quantity : '1',
      unit: i.unit || undefined,
      planId: i.planId || undefined,
    }
  })
  const parsed = z.array(itemSchema).min(1, '請至少填一個報價項目').safeParse(filled)
  if (!parsed.success) return formError(parsed.error)

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    with: { client: true },
  })
  if (!project) return fail('NOT_FOUND', '找不到這個專案')

  const config = await getSettings()

  const lines = parsed.data.map((i, index) => {
    const cents = lineAmountCents(i.unitPrice, i.quantity)
    return {
      description: i.description,
      specNote: i.planId ? (specOf.get(i.planId) ?? null) : null,
      quantity: Number(i.quantity).toFixed(2),
      unit: i.unit,
      unitPrice: fromCents(toCents(i.unitPrice)),
      amount: fromCents(cents),
      cents,
      sortOrder: index,
    }
  })
  const totals = computeTotals(
    lines.map((l) => l.cents),
    config.defaultTaxMode as TaxMode,
    config.defaultTaxRate,
  )
  const issueDate = today()

  const quote = await db.transaction(async (tx) => {
    const quoteNo = await nextQuoteNo(tx, issueDate)
    const [row] = await tx
      .insert(quotes)
      .values({
        quoteNo,
        projectName: project.name,
        clientId: project.clientId,
        siteId: project.siteId,
        projectId: project.id,
        status: 'draft',
        anchorDate: null,
        issueDate,
        validUntil: plusDays(issueDate, config.quoteValidDays),
        currency: project.currency,
        taxMode: config.defaultTaxMode,
        taxRate: config.defaultTaxRate,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
        terms: config.quoteTerms,
      })
      .returning()

    await tx.insert(quoteItems).values(
      lines.map((l) => ({
        quoteId: row.id,
        description: l.description,
        specNote: l.specNote,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        amount: l.amount,
        sortOrder: l.sortOrder,
      })),
    )
    return row
  })

  await logActivity(actor, 'quote.created_from_project', 'quote', quote.id, {
    projectId,
    quoteNo: quote.quoteNo,
  })
  return { ok: true, quoteId: quote.id }
}
