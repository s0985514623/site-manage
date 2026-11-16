'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'

import { requireUser } from '@/auth'
import { db } from '@/db'
import { quoteAttachments, quotes, services } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { checkUploadFile } from '@/lib/upload-file'
import { type ActionState } from './helpers'

/**
 * 報價單附件：客戶回簽的報價單、匯款證明。
 *
 * 這些檔案是收款與爭議時的憑證，所以直接存進資料庫（bytea）——
 * 跟客戶資料一起備份，不會因為容器重啟或忘了掛 volume 就不見。
 */

function read(formData: FormData, key: string): string {
  const v = formData.get(key)
  return typeof v === 'string' ? v : ''
}

export async function uploadAttachment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const quoteId = read(formData, 'quoteId')

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { error: '請選擇要上傳的檔案' }
  }
  const checked = await checkUploadFile(file)
  if (!checked.ok) return { error: checked.error }
  const { buffer, contentType: actual, filename } = checked.file

  const quote = await db.query.quotes.findFirst({ where: eq(quotes.id, quoteId) })
  if (!quote) return { error: '找不到這張報價單' }

  const kindRaw = read(formData, 'kind')
  const kind = (
    ['signed_quote', 'payment_proof', 'other'] as const
  ).includes(kindRaw as never)
    ? (kindRaw as 'signed_quote' | 'payment_proof' | 'other')
    : 'signed_quote'

  const signedOn = read(formData, 'signedOn')

  await db.insert(quoteAttachments).values({
    quoteId,
    kind,
    filename,
    contentType: actual,
    sizeBytes: buffer.byteLength,
    data: buffer,
    signedOn: /^\d{4}-\d{2}-\d{2}$/.test(signedOn) ? signedOn : null,
    note: read(formData, 'note') || null,
    uploadedBy: email,
  })

  /**
   * 收到回簽通常就代表客戶同意了，但仍做成明確勾選而不是自動推進：
   * 有時上傳的是待確認的草稿，或只是先留存，不該替你決定狀態。
   */
  if (
    formData.get('markAccepted') === 'on' &&
    quote.status !== 'accepted'
  ) {
    await db
      .update(quotes)
      .set({ status: 'accepted', updatedAt: new Date() })
      .where(eq(quotes.id, quoteId))
    await db
      .update(services)
      .set({ renewalState: 'accepted', updatedAt: new Date() })
      .where(eq(services.currentQuoteId, quoteId))
  }

  await logActivity(email, 'attachment.uploaded', 'quote', quoteId, {
    filename: file.name,
    kind,
    sizeBytes: buffer.byteLength,
  })

  revalidatePath(`/quotes/${quoteId}`)
  return { ok: true }
}

export async function deleteAttachment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')
  const quoteId = read(formData, 'quoteId')

  const row = await db.query.quoteAttachments.findFirst({
    where: eq(quoteAttachments.id, id),
    columns: { filename: true },
  })

  await db.delete(quoteAttachments).where(eq(quoteAttachments.id, id))
  await logActivity(email, 'attachment.deleted', 'quote', quoteId, {
    filename: row?.filename,
  })

  revalidatePath(`/quotes/${quoteId}`)
  return { ok: true }
}
