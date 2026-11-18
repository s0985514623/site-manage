'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { eq, sql } from 'drizzle-orm'

import { requireUser } from '@/auth'
import { db } from '@/db'
import { quotes, services } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { advanceByCycle, type BillingCycle } from '@/lib/dates'
import { checkUploadFile, type CheckedFile } from '@/lib/upload-file'
import { registerPayment } from '@/server/quotes/payment'
import { createRenewalQuote } from '@/server/quotes/renewal'
import { cancelQuote, sendQuoteToClient } from '@/server/send-quote'
import { type ActionState } from './helpers'

function read(formData: FormData, key: string): string {
  const v = formData.get(key)
  return typeof v === 'string' ? v : ''
}

/**
 * 從後台手動寄出報價單。
 *
 * 與 LINE 審核是兩條並行的路徑，共用同一個 sendQuoteToClient。
 * 這條路徑的授權來自登入 session，所以不需要一次性 token；
 * 但介面上必須先展開確認區塊並看到收件人，才會出現送出按鈕。
 */
export async function sendQuote(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')

  // 狀態檢查、搶佔（防連點重複寄出）都在 sendQuoteToClient 裡
  const result = await sendQuoteToClient(id, email)
  if (!result.ok) return { error: result.error, violationType: result.violationType }

  revalidatePath('/quotes')
  revalidatePath(`/quotes/${id}`)
  return { ok: true }
}

/**
 * 手動開立續約報價單（網站頁、到期總表的按鈕）。
 * 成功後直接跳到報價單頁，讓管理者檢查內容後寄出。
 */
export async function createRenewalQuoteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const siteId = read(formData, 'siteId')

  const result = await createRenewalQuote(siteId, email)
  if (!result.ok) return { error: result.error, violationType: result.violationType }

  revalidatePath('/quotes')
  revalidatePath('/services')
  revalidatePath(`/sites/${siteId}`)
  redirect(`/quotes/${result.quoteId}`)
}

export async function cancelQuoteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')

  const result = await cancelQuote(id, email)
  if (!result.ok) return { error: result.error }

  revalidatePath('/quotes')
  revalidatePath(`/quotes/${id}`)
  revalidatePath('/services')
  return { ok: true }
}

/** 客戶回覆同意。只改狀態，續約推進另外按「標記已續約」 */
export async function markAccepted(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')

  // accepted_at 是專案報價「未收款提醒」的起算點，只記第一次同意的時間
  await db
    .update(quotes)
    .set({
      status: 'accepted',
      acceptedAt: sql`coalesce(${quotes.acceptedAt}, ${new Date().toISOString()}::timestamptz)`,
      updatedAt: new Date(),
    })
    .where(eq(quotes.id, id))
  await db
    .update(services)
    .set({ renewalState: 'accepted', updatedAt: new Date() })
    .where(eq(services.currentQuoteId, id))

  await logActivity(email, 'quote.accepted', 'quote', id)
  revalidatePath(`/quotes/${id}`)
  revalidatePath('/services')
  return { ok: true }
}

export async function markRejected(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')

  await db
    .update(quotes)
    .set({ status: 'rejected', updatedAt: new Date() })
    .where(eq(quotes.id, id))
  await db
    .update(services)
    .set({ renewalState: 'declined', updatedAt: new Date() })
    .where(eq(services.currentQuoteId, id))

  await logActivity(email, 'quote.rejected', 'quote', id)
  revalidatePath(`/quotes/${id}`)
  revalidatePath('/services')
  return { ok: true }
}

/**
 * 客戶已付款、續約完成：把這張報價單涵蓋的所有項目一次推進到期日。
 *
 * 每個項目各自依自己的計費週期推進 —— 與報價單上「各項期間各自起算」
 * 的規則一致，否則資料會跟客戶手上的報價單對不起來。
 */
export async function markQuoteRenewed(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')

  const covered = await db.query.services.findMany({
    where: eq(services.currentQuoteId, id),
  })
  if (covered.length === 0) {
    return { error: '這張報價單沒有涵蓋任何項目，或項目已被處理過。' }
  }

  const advanced: { identifier: string; from: string; to: string }[] = []

  await db.transaction(async (tx) => {
    for (const service of covered) {
      const next = advanceByCycle(
        service.expiresAt,
        service.billingCycle as BillingCycle,
      )
      advanced.push({
        identifier: service.identifier,
        from: service.expiresAt,
        to: next,
      })
      await tx
        .update(services)
        .set({
          expiresAt: next,
          startedAt: service.expiresAt,
          status: 'active',
          renewalState: 'upcoming',
          currentQuoteId: null,
          updatedAt: new Date(),
        })
        .where(eq(services.id, service.id))
    }
    await tx
      .update(quotes)
      .set({
        status: 'accepted',
        acceptedAt: sql`coalesce(${quotes.acceptedAt}, ${new Date().toISOString()}::timestamptz)`,
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, id))
  })

  await logActivity(email, 'quote.renewed', 'quote', id, { advanced })

  revalidatePath(`/quotes/${id}`)
  revalidatePath('/services')
  revalidatePath('/')
  return { ok: true }
}

/** 登記收款（可附匯款證明）。規則見 src/server/quotes/payment.ts */
export async function registerPaymentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')

  let proof: CheckedFile | undefined
  const file = formData.get('proof')
  if (file instanceof File && file.size > 0) {
    const checked = await checkUploadFile(file)
    if (!checked.ok) return { error: checked.error, violationType: 'INVALID_ARGUMENT' }
    proof = checked.file
  }

  const result = await registerPayment(
    id,
    { paidOn: read(formData, 'paidOn'), paidAmount: read(formData, 'paidAmount'), proof },
    email,
  )
  if (result.ok) {
    revalidatePath(`/quotes/${id}`)
    revalidatePath('/quotes')
  }
  return result
}
