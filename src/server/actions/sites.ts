'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { requireUser } from '@/auth'
import { db } from '@/db'
import { sites } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { formError, type ActionState } from './helpers'

const siteSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().trim().min(1, '請填寫網站名稱'),
  primaryUrl: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^https?:\/\/.+/.test(v),
      '網址需以 http:// 或 https:// 開頭',
    ),
  cmsType: z.string().trim(),
  status: z.enum(['building', 'live', 'paused', 'closed']),
  dnsNote: z.string().trim(),
  note: z.string().trim(),
})

function read(formData: FormData, key: string): string {
  const v = formData.get(key)
  return typeof v === 'string' ? v : ''
}

export async function createSite(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()

  const parsed = siteSchema.safeParse({
    clientId: read(formData, 'clientId'),
    name: read(formData, 'name'),
    primaryUrl: read(formData, 'primaryUrl'),
    cmsType: read(formData, 'cmsType'),
    status: read(formData, 'status') || 'live',
    dnsNote: read(formData, 'dnsNote'),
    note: read(formData, 'note'),
  })
  if (!parsed.success) return formError(parsed.error)

  const d = parsed.data
  const [row] = await db
    .insert(sites)
    .values({
      clientId: d.clientId,
      name: d.name,
      primaryUrl: d.primaryUrl || null,
      cmsType: d.cmsType || null,
      status: d.status,
      dnsNote: d.dnsNote || null,
      note: d.note || null,
      // 新網站預設開啟存活監控；沒網址就沒東西可探測
      monitorEnabled: !!d.primaryUrl,
    })
    .returning()

  await logActivity(email, 'site.created', 'site', row.id, { name: row.name })
  revalidatePath(`/clients/${d.clientId}`)
  redirect(`/sites/${row.id}`)
}

export async function updateSite(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')

  const parsed = siteSchema.safeParse({
    clientId: read(formData, 'clientId'),
    name: read(formData, 'name'),
    primaryUrl: read(formData, 'primaryUrl'),
    cmsType: read(formData, 'cmsType'),
    status: read(formData, 'status') || 'live',
    dnsNote: read(formData, 'dnsNote'),
    note: read(formData, 'note'),
  })
  if (!parsed.success) return formError(parsed.error)

  const d = parsed.data
  const monitorEnabled = formData.get('monitorEnabled') === 'on'

  if (monitorEnabled && !d.primaryUrl) {
    return { error: '要開啟存活監控，必須先填寫網站網址' }
  }

  await db
    .update(sites)
    .set({
      name: d.name,
      primaryUrl: d.primaryUrl || null,
      cmsType: d.cmsType || null,
      status: d.status,
      dnsNote: d.dnsNote || null,
      note: d.note || null,
      monitorEnabled,
      updatedAt: new Date(),
    })
    .where(eq(sites.id, id))

  await logActivity(email, 'site.updated', 'site', id)
  revalidatePath(`/sites/${id}`)
  revalidatePath(`/clients/${d.clientId}`)
  return { ok: true }
}

export async function deleteSite(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')
  const clientId = read(formData, 'clientId')

  // 服務項目會一併 cascade 刪除，但報價單的 FK 是 restrict，會擋住
  try {
    await db.delete(sites).where(eq(sites.id, id))
  } catch {
    return {
      error:
        '這個網站已有報價單紀錄，無法刪除。若已結束服務，請將狀態改為「已結案」以保留歷史資料。',
    }
  }

  await logActivity(email, 'site.deleted', 'site', id, { clientId })
  revalidatePath(`/clients/${clientId}`)
  redirect(`/clients/${clientId}`)
}
