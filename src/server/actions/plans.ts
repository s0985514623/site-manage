'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { requireUser } from '@/auth'
import { db } from '@/db'
import { plans, services } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { formError, type ActionState } from './helpers'

/**
 * 方案範本：報價單上「概要／功能說明」那一格的文字來源。
 *
 * 主機規格每年續約都一樣，存成範本後建立服務項目時選一次即可，
 * 不必每年重打。
 */

const schema = z.object({
  name: z.string().trim().min(1, '請填寫方案名稱'),
  type: z.enum([
    'domain',
    'hosting',
    'ssl',
    'maintenance',
    'email',
    'license',
    'cdn',
    'other',
  ]),
  specNote: z.string().trim().min(1, '請填寫規格說明，這段文字會印在報價單上'),
  priceAmount: z.string().trim(),
  billingCycle: z.enum([
    'monthly',
    'quarterly',
    'yearly',
    'biennial',
    'triennial',
  ]),
  note: z.string().trim(),
  sortOrder: z.coerce.number().int(),
})

function read(formData: FormData, key: string): string {
  const v = formData.get(key)
  return typeof v === 'string' ? v : ''
}

function money(value: string): string | null {
  if (value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : null
}

export async function savePlan(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')

  const parsed = schema.safeParse({
    name: read(formData, 'name'),
    type: read(formData, 'type') || 'hosting',
    specNote: read(formData, 'specNote'),
    priceAmount: read(formData, 'priceAmount'),
    billingCycle: read(formData, 'billingCycle') || 'yearly',
    note: read(formData, 'note'),
    sortOrder: read(formData, 'sortOrder') || '0',
  })
  if (!parsed.success) return formError(parsed.error)

  const d = parsed.data
  const values = {
    name: d.name,
    type: d.type,
    specNote: d.specNote,
    priceAmount: money(d.priceAmount),
    billingCycle: d.billingCycle,
    note: d.note || null,
    sortOrder: d.sortOrder,
    active: formData.get('inactive') !== 'on',
    updatedAt: new Date(),
  }

  if (id) {
    await db.update(plans).set(values).where(eq(plans.id, id))
  } else {
    await db.insert(plans).values(values)
  }

  await logActivity(email, id ? 'plan.updated' : 'plan.created', 'plan', id || null, {
    name: d.name,
  })
  revalidatePath('/settings')
  return { ok: true }
}

export async function deletePlan(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')

  /**
   * 已被服務項目引用的範本不刪除，改建議停用。
   * FK 是 set null，硬刪雖不會報錯，但那些項目會默默失去規格說明，
   * 下次續約的報價單上就少了一整格內容而沒人發現。
   */
  const inUse = await db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.planId, id))
    .limit(1)

  if (inUse.length > 0) {
    return {
      error:
        '這個方案已被服務項目使用，無法刪除。若不再提供，請改勾選「停用」——既有項目的規格說明會保留。',
    }
  }

  await db.delete(plans).where(eq(plans.id, id))
  await logActivity(email, 'plan.deleted', 'plan', id)
  revalidatePath('/settings')
  return { ok: true }
}
