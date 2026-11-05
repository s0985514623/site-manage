'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { requireUser } from '@/auth'
import { db } from '@/db'
import { clients, contacts, quotes } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { formError, type ActionState } from './helpers'

const clientSchema = z.object({
  name: z.string().trim().min(1, '請填寫客戶名稱'),
  shortName: z.string().trim(),
  representative: z.string().trim(),
  taxId: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{8}$/.test(v), '統一編號需為 8 位數字'),
  phone: z.string().trim(),
  address: z.string().trim(),
  note: z.string().trim(),
})

const contactSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().trim().min(1, '請填寫聯絡人姓名'),
  role: z.enum(['decision', 'finance', 'tech', 'other']),
  email: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || z.string().email().safeParse(v).success,
      'Email 格式不正確',
    ),
  phone: z.string().trim(),
  isPrimary: z.coerce.boolean(),
  receiveQuotes: z.coerce.boolean(),
})

function read(formData: FormData, key: string): string {
  const v = formData.get(key)
  return typeof v === 'string' ? v : ''
}

function readBool(formData: FormData, key: string): boolean {
  return formData.get(key) === 'on' || formData.get(key) === 'true'
}

export async function createClient(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()

  const parsed = clientSchema.safeParse({
    name: read(formData, 'name'),
    shortName: read(formData, 'shortName'),
    representative: read(formData, 'representative'),
    taxId: read(formData, 'taxId'),
    phone: read(formData, 'phone'),
    address: read(formData, 'address'),
    note: read(formData, 'note'),
  })
  if (!parsed.success) return formError(parsed.error)

  const [row] = await db
    .insert(clients)
    .values({
      name: parsed.data.name,
      shortName: parsed.data.shortName || null,
      representative: parsed.data.representative || null,
      taxId: parsed.data.taxId || null,
      phone: parsed.data.phone || null,
      address: parsed.data.address || null,
      note: parsed.data.note || null,
    })
    .returning()

  await logActivity(email, 'client.created', 'client', row.id, {
    name: row.name,
  })

  revalidatePath('/clients')
  redirect(`/clients/${row.id}`)
}

export async function updateClient(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')

  const parsed = clientSchema.safeParse({
    name: read(formData, 'name'),
    shortName: read(formData, 'shortName'),
    representative: read(formData, 'representative'),
    taxId: read(formData, 'taxId'),
    phone: read(formData, 'phone'),
    address: read(formData, 'address'),
    note: read(formData, 'note'),
  })
  if (!parsed.success) return formError(parsed.error)

  await db
    .update(clients)
    .set({
      name: parsed.data.name,
      shortName: parsed.data.shortName || null,
      representative: parsed.data.representative || null,
      taxId: parsed.data.taxId || null,
      phone: parsed.data.phone || null,
      address: parsed.data.address || null,
      note: parsed.data.note || null,
      status: readBool(formData, 'inactive') ? 'inactive' : 'active',
      updatedAt: new Date(),
    })
    .where(eq(clients.id, id))

  await logActivity(email, 'client.updated', 'client', id)
  revalidatePath('/clients')
  revalidatePath(`/clients/${id}`)
  return { ok: true }
}

export async function deleteClient(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')

  /**
   * 報價單是財務紀錄，刪客戶會被 FK 的 onDelete: restrict 擋下。
   * 與其讓使用者撞上資料庫錯誤，不如先說清楚該怎麼做。
   */
  const existingQuotes = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(eq(quotes.clientId, id))
    .limit(1)

  if (existingQuotes.length > 0) {
    return {
      error:
        '這個客戶已有報價單紀錄，無法刪除。若已結束合作，請改將狀態設為「停用」，保留歷史資料。',
    }
  }

  await db.delete(clients).where(eq(clients.id, id))
  await logActivity(email, 'client.deleted', 'client', id)

  revalidatePath('/clients')
  redirect('/clients')
}

export async function saveContact(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')

  const parsed = contactSchema.safeParse({
    clientId: read(formData, 'clientId'),
    name: read(formData, 'name'),
    role: read(formData, 'role') || 'other',
    email: read(formData, 'email'),
    phone: read(formData, 'phone'),
    isPrimary: readBool(formData, 'isPrimary'),
    receiveQuotes: readBool(formData, 'receiveQuotes'),
  })
  if (!parsed.success) return formError(parsed.error)

  const data = parsed.data

  /**
   * 勾了「接收報價單」卻沒填 Email，等於這位窗口永遠收不到報價。
   * 這種錯誤要在建立當下擋掉，不能等到寄信那天才發現。
   */
  if (data.receiveQuotes && !data.email) {
    return { error: '勾選「接收報價單」的聯絡人必須填寫 Email' }
  }

  const values = {
    clientId: data.clientId,
    name: data.name,
    role: data.role,
    email: data.email || null,
    phone: data.phone || null,
    isPrimary: data.isPrimary,
    receiveQuotes: data.receiveQuotes,
    updatedAt: new Date(),
  }

  await db.transaction(async (tx) => {
    // 主要聯絡人只能有一位
    if (data.isPrimary) {
      await tx
        .update(contacts)
        .set({ isPrimary: false })
        .where(eq(contacts.clientId, data.clientId))
    }
    if (id) {
      await tx
        .update(contacts)
        .set(values)
        .where(and(eq(contacts.id, id), eq(contacts.clientId, data.clientId)))
    } else {
      await tx.insert(contacts).values(values)
    }
  })

  await logActivity(
    email,
    id ? 'contact.updated' : 'contact.created',
    'contact',
    id || null,
    { clientId: data.clientId, name: data.name },
  )

  revalidatePath(`/clients/${data.clientId}`)
  return { ok: true }
}

export async function deleteContact(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')
  const clientId = read(formData, 'clientId')

  await db.delete(contacts).where(eq(contacts.id, id))
  await logActivity(email, 'contact.deleted', 'contact', id, { clientId })

  revalidatePath(`/clients/${clientId}`)
  return { ok: true }
}
