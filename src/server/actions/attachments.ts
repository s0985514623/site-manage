'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'

import { requireUser } from '@/auth'
import { db } from '@/db'
import { quoteAttachments, quotes, services } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { type ActionState } from './helpers'

/**
 * 報價單附件：客戶回簽的報價單、匯款證明。
 *
 * 這些檔案是收款與爭議時的憑證，所以直接存進資料庫（bytea）——
 * 跟客戶資料一起備份，不會因為容器重啟或忘了掛 volume 就不見。
 */

const MAX_BYTES = 10 * 1024 * 1024

/**
 * 只接受這幾種格式。
 *
 * 不是為了限制你，而是因為這些檔案之後會由瀏覽器開啟：
 * 允許 HTML 或 SVG 會讓上傳的檔案在同源下執行指令碼。
 */
const ALLOWED = new Map<string, string[]>([
  ['application/pdf', ['.pdf']],
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['image/png', ['.png']],
  ['image/heic', ['.heic']], // iPhone 直接拍的照片
  ['image/webp', ['.webp']],
])

/** 檔案開頭的位元組。副檔名與 MIME 都可以偽造，內容不行 */
const MAGIC: { type: string; bytes: number[] }[] = [
  { type: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
]

function sniff(buffer: Buffer): string | null {
  for (const { type, bytes } of MAGIC) {
    if (bytes.every((b, i) => buffer[i] === b)) return type
  }
  // HEIC/WebP 的識別碼在位移 4 之後
  const brand = buffer.subarray(4, 12).toString('latin1')
  if (brand.startsWith('ftyphe') || brand.startsWith('ftypmif')) {
    return 'image/heic'
  }
  if (
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

function read(formData: FormData, key: string): string {
  const v = formData.get(key)
  return typeof v === 'string' ? v : ''
}

/** 去掉路徑並限制長度，避免檔名被拿來做路徑穿越 */
function safeName(name: string): string {
  return (
    name
      .replace(/[\\/]/g, '_')
      .replace(/[\u0000-\u001f]/g, '')
      .trim()
      .slice(0, 180) || '未命名檔案'
  )
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
  if (file.size > MAX_BYTES) {
    return {
      error: `檔案 ${(file.size / 1024 / 1024).toFixed(1)}MB 超過上限 10MB。掃描件請調低解析度，或改存 PDF。`,
    }
  }

  const declared = file.type || ''
  if (!ALLOWED.has(declared)) {
    return {
      error: `不支援的檔案格式（${declared || '未知'}）。請上傳 PDF、JPG、PNG、HEIC 或 WebP。`,
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const actual = sniff(buffer)

  /**
   * 副檔名與瀏覽器回報的 MIME 都可以偽造，所以比對檔案開頭的位元組。
   * 對不上就拒絕 —— 這些檔案之後會被瀏覽器開啟。
   */
  if (!actual) {
    return { error: '無法辨識檔案內容，請確認檔案沒有損毀' }
  }
  if (actual !== declared && !(declared === 'image/jpeg' && actual === 'image/jpeg')) {
    return {
      error: `檔案內容與宣稱的格式不符（宣稱 ${declared}，實際 ${actual}）`,
    }
  }

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
    filename: safeName(file.name),
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
