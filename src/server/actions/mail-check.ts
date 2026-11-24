'use server'

import { revalidatePath } from 'next/cache'

import { requireUser } from '@/auth'
import { logActivity } from '@/lib/activity'
import { checkMailService } from '@/server/mail-check'
import type { ActionState } from './helpers'

/** 網站頁「立即檢查」信箱 */
export async function checkMailbox(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = await requireUser()
  const id = String(formData.get('id') ?? '')
  const siteId = String(formData.get('siteId') ?? '')

  const result = await checkMailService(id)
  if (result.ok) await logActivity(email, 'service.mail_checked', 'service', id, {})

  revalidatePath(`/sites/${siteId}`)
  return result
}
