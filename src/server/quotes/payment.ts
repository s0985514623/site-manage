import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { clients, quoteAttachments, quotes } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { plusDays, today } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import type { CheckedFile } from '@/lib/upload-file'
import { fail, formError, type ActionState } from '@/server/actions/helpers'
import { isReminderDay, sendReminders, taipeiDate, type ReminderItem } from './reminders'

/* ------------------------------------------------------------------ */
/* 登記收款                                                             */
/* ------------------------------------------------------------------ */

const PAYABLE = ['sent', 'accepted'] as const

export type PaymentInput = {
  paidOn: string
  paidAmount: string
  /** 匯款證明（選填），已通過 checkUploadFile 檢查 */
  proof?: CheckedFile
}

/**
 * 登記收款 = 客戶已同意：原為「已寄出」者一併改為「客戶已同意」。
 * 不會自動推進服務項目到期日（續約仍在報價單頁按「標記已續約」）。
 * 以 paid_on IS NULL 條件更新，連點兩次不會重複入帳。
 */
export async function registerPayment(
  quoteId: string,
  input: PaymentInput,
  actor: string,
): Promise<ActionState> {
  const now = today()
  const parsed = z
    .object({
      paidOn: z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/, '請填寫收款日期')
        .refine((v) => v <= now, '收款日期不可晚於今天'),
      paidAmount: z
        .string()
        .trim()
        .min(1, '請填寫實收金額')
        .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, '實收金額必須大於 0'),
    })
    .safeParse({ paidOn: input.paidOn ?? '', paidAmount: input.paidAmount ?? '' })
  if (!parsed.success) return formError(parsed.error)

  const quote = await db.query.quotes.findFirst({ where: eq(quotes.id, quoteId) })
  if (!quote) return fail('NOT_FOUND', '找不到這張報價單')
  if (quote.paidOn) return fail('ALREADY_PAID', '這張報價單已經登記過收款')
  if (!(PAYABLE as readonly string[]).includes(quote.status)) {
    return fail('INVALID_QUOTE_STATUS', '只有已寄出或客戶已同意的報價單可以登記收款')
  }

  const ok = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(quotes)
      .set({
        status: 'accepted',
        acceptedAt: sql`coalesce(${quotes.acceptedAt}, ${new Date().toISOString()}::timestamptz)`,
        paidOn: parsed.data.paidOn,
        paidAmount: Number(parsed.data.paidAmount).toFixed(2),
        updatedAt: new Date(),
      })
      .where(and(eq(quotes.id, quoteId), isNull(quotes.paidOn), inArray(quotes.status, [...PAYABLE])))
      .returning({ id: quotes.id })
    if (!row) return false

    if (input.proof) {
      await tx.insert(quoteAttachments).values({
        quoteId,
        kind: 'payment_proof',
        filename: input.proof.filename,
        contentType: input.proof.contentType,
        sizeBytes: input.proof.size,
        data: input.proof.buffer,
        signedOn: parsed.data.paidOn,
        uploadedBy: actor,
      })
    }
    return true
  })
  if (!ok) return fail('ALREADY_PAID', '這張報價單已經登記過收款')

  await logActivity(actor, 'quote.paid', 'quote', quoteId, {
    quoteNo: quote.quoteNo,
    paidOn: parsed.data.paidOn,
    paidAmount: parsed.data.paidAmount,
  })
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* 未收款追蹤                                                           */
/* ------------------------------------------------------------------ */

/** 續約報價：錨點到期日前 7 天起；專案報價：客戶同意後 14 天起；之後每 3 天 */
export const PAYMENT_RULE = { renewalLeadDays: 7, projectGraceDays: 14, every: 3 } as const

export function paymentReminderStart(q: {
  projectId: string | null
  anchorDate: string | null
  acceptedAt: Date | null
}): string | null {
  if (!q.projectId && q.anchorDate) return plusDays(q.anchorDate, -PAYMENT_RULE.renewalLeadDays)
  if (q.projectId && q.acceptedAt) {
    return plusDays(taipeiDate(q.acceptedAt), PAYMENT_RULE.projectGraceDays)
  }
  return null
}

export async function runPaymentFollowup(dryRun: boolean) {
  const rows = await db
    .select({
      id: quotes.id,
      quoteNo: quotes.quoteNo,
      projectId: quotes.projectId,
      anchorDate: quotes.anchorDate,
      acceptedAt: quotes.acceptedAt,
      total: quotes.total,
      currency: quotes.currency,
      clientName: clients.name,
    })
    .from(quotes)
    .innerJoin(clients, eq(quotes.clientId, clients.id))
    .where(and(eq(quotes.status, 'accepted'), isNull(quotes.paidOn)))
    .orderBy(desc(quotes.quoteNo))

  const candidates: ReminderItem[] = []
  for (const q of rows) {
    const start = paymentReminderStart(q)
    if (!start || !isReminderDay(start, PAYMENT_RULE.every)) continue
    candidates.push({
      quoteId: q.id,
      quoteNo: q.quoteNo,
      detail: `${q.quoteNo} ${q.clientName} ${formatMoney(q.total, q.currency)}${
        q.projectId ? '（專案）' : `，${q.anchorDate} 到期`
      }，尚未收款`,
    })
  }

  return sendReminders('payment_followup', '收款追蹤', candidates, dryRun)
}
