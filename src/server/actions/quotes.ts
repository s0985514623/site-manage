'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'

import { requireUser } from '@/auth'
import { db } from '@/db'
import { quotes, services } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { advanceByCycle, type BillingCycle } from '@/lib/dates'
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

  const quote = await db.query.quotes.findFirst({ where: eq(quotes.id, id) })
  if (!quote) return { error: '找不到這張報價單' }

  // 狀態機守衛：已寄出的不該再寄一次
  if (quote.status === 'sent' || quote.status === 'accepted') {
    return { error: '這張報價單已經寄出過了，沒有重複寄送。' }
  }
  if (quote.status === 'cancelled') {
    return { error: '這張報價單已取消，無法寄出。' }
  }

  const result = await sendQuoteToClient(id, email)
  if (!result.ok) return { error: result.error }

  revalidatePath('/quotes')
  revalidatePath(`/quotes/${id}`)
  return { ok: true }
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

  await db
    .update(quotes)
    .set({ status: 'accepted', updatedAt: new Date() })
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
      .set({ status: 'accepted', updatedAt: new Date() })
      .where(eq(quotes.id, id))
  })

  await logActivity(email, 'quote.renewed', 'quote', id, { advanced })

  revalidatePath(`/quotes/${id}`)
  revalidatePath('/services')
  revalidatePath('/')
  return { ok: true }
}
