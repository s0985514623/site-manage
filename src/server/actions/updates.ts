'use server'

import { revalidatePath } from 'next/cache'

import { requireUser } from '@/auth'
import { addUpdate, deleteUpdate, type UpdateTarget } from '@/server/updates'
import { type ActionState } from './helpers'

function read(formData: FormData, key: string): string {
  const v = formData.get(key)
  return typeof v === 'string' ? v : ''
}

function targetOf(formData: FormData): { target: UpdateTarget; path: string } | null {
  const projectId = read(formData, 'projectId')
  const siteId = read(formData, 'siteId')
  if (projectId) return { target: { projectId }, path: `/projects/${projectId}` }
  if (siteId) return { target: { siteId }, path: `/sites/${siteId}` }
  return null
}

/** 新增一則近況（文字＋圖片） */
export async function addUpdateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = await requireUser()
  const t = targetOf(formData)
  if (!t) return { error: '缺少專案或網站', violationType: 'INVALID_ARGUMENT' }

  const images = formData.getAll('images').filter((f): f is File => f instanceof File)
  const result = await addUpdate(t.target, { body: read(formData, 'body'), images }, email)
  if (!result.ok) return { error: result.error, violationType: result.violationType }

  revalidatePath(t.path)
  return { ok: true }
}

export async function deleteUpdateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = await requireUser()
  const t = targetOf(formData)
  const result = await deleteUpdate(read(formData, 'id'), email)
  if (!result.ok) return result
  if (t) revalidatePath(t.path)
  return { ok: true }
}
