'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { requireUser } from '@/auth'
import { db } from '@/db'
import { credentials } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { decrypt, encrypt } from '@/lib/crypto'
import { formError, type ActionState } from './helpers'

/**
 * 主機／FTP／後台的登入憑證。
 *
 * 密碼一律 AES-256-GCM 加密後才落地，明文不進資料庫、不進記錄檔。
 * 解密只發生在你按下「顯示」的那一刻，且每次都寫入稽核紀錄 ——
 * 這份資料等同客戶網站的鑰匙，誰在什麼時候看過必須留痕。
 */

const schema = z.object({
  serviceId: z.string().uuid(),
  label: z.string().trim().min(1, '請填寫用途，例如「WP 後台」'),
  url: z.string().trim(),
  username: z.string().trim(),
  note: z.string().trim(),
})

function read(formData: FormData, key: string): string {
  const v = formData.get(key)
  return typeof v === 'string' ? v : ''
}

export async function saveCredential(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')
  const siteId = read(formData, 'siteId')

  const parsed = schema.safeParse({
    serviceId: read(formData, 'serviceId'),
    label: read(formData, 'label'),
    url: read(formData, 'url'),
    username: read(formData, 'username'),
    note: read(formData, 'note'),
  })
  if (!parsed.success) return formError(parsed.error)

  const d = parsed.data
  const secret = read(formData, 'secret')

  // 編輯時留空代表「不變更密碼」；新建時則必填
  if (!id && !secret) return { error: '請填寫密碼' }

  const base = {
    serviceId: d.serviceId,
    label: d.label,
    url: d.url || null,
    username: d.username || null,
    note: d.note || null,
    updatedAt: new Date(),
  }

  if (id) {
    const values = secret
      ? (() => {
          const box = encrypt(secret)
          return {
            ...base,
            secretEncrypted: box.ciphertext,
            secretIv: box.iv,
            secretTag: box.tag,
          }
        })()
      : base
    await db.update(credentials).set(values).where(eq(credentials.id, id))
  } else {
    const box = encrypt(secret)
    await db.insert(credentials).values({
      ...base,
      secretEncrypted: box.ciphertext,
      secretIv: box.iv,
      secretTag: box.tag,
    })
  }

  await logActivity(
    email,
    id ? 'credential.updated' : 'credential.created',
    'credential',
    id || null,
    { label: d.label, secretChanged: Boolean(secret) },
  )

  revalidatePath(`/sites/${siteId}`)
  return { ok: true }
}

export async function deleteCredential(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')
  const siteId = read(formData, 'siteId')

  await db.delete(credentials).where(eq(credentials.id, id))
  await logActivity(email, 'credential.deleted', 'credential', id)

  revalidatePath(`/sites/${siteId}`)
  return { ok: true }
}

export type RevealState = {
  error?: string
  secret?: string
  label?: string
}

/**
 * 顯示密碼明文。
 *
 * 刻意做成需要一次明確操作而非直接印在頁面上：
 * 畫面會被截圖、被旁人看到、被瀏覽器快取。每次解密都留稽核紀錄。
 */
export async function revealCredential(
  _prev: RevealState,
  formData: FormData,
): Promise<RevealState> {
  const email = await requireUser()
  const id = read(formData, 'id')

  const row = await db.query.credentials.findFirst({
    where: eq(credentials.id, id),
  })
  if (!row) return { error: '找不到這筆憑證' }

  try {
    const secret = decrypt({
      ciphertext: row.secretEncrypted,
      iv: row.secretIv,
      tag: row.secretTag,
    })

    await db
      .update(credentials)
      .set({ lastAccessedAt: new Date() })
      .where(eq(credentials.id, id))

    await logActivity(email, 'credential.revealed', 'credential', id, {
      label: row.label,
    })

    return { secret, label: row.label }
  } catch (error) {
    // 解密失敗通常代表換過 ENCRYPTION_KEY，必須讓人看見而不是靜默略過
    return {
      error: error instanceof Error ? error.message : '解密失敗',
    }
  }
}
