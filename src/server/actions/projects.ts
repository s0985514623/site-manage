'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireUser } from '@/auth'
import { HANDOVER_TYPES } from '@/server/projects/handover-types'
import { submitHandover } from '@/server/projects/handover'
import { createProjectQuote } from '@/server/projects/quote'
import {
  addMilestone,
  deleteMilestone,
  toggleMilestoneDone,
  updateMilestone,
} from '@/server/projects/milestones'
import {
  createProject,
  deleteProject,
  updateProject,
  updateProjectStatus,
} from '@/server/projects/projects'
import type { ActionState } from './helpers'

/**
 * 專案的 Server Actions：只做登入檢查、FormData 解析、revalidate，
 * 業務規則都在 src/server/projects/。
 */

function read(formData: FormData, key: string): string {
  const v = formData.get(key)
  return typeof v === 'string' ? v : ''
}

function projectFields(formData: FormData) {
  return {
    name: read(formData, 'name'),
    clientId: read(formData, 'clientId'),
    category: read(formData, 'category'),
    siteId: read(formData, 'siteId'),
    startDate: read(formData, 'startDate'),
    dueDate: read(formData, 'dueDate'),
    description: read(formData, 'description'),
    estimatedAmount: read(formData, 'estimatedAmount'),
  }
}

export async function createProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const result = await createProject(projectFields(formData), email)
  if (!result.ok || !result.projectId) return result
  revalidatePath('/projects')
  redirect(`/projects/${result.projectId}`)
}

export async function updateProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')
  const result = await updateProject(id, projectFields(formData), email)
  if (result.ok) {
    revalidatePath('/projects')
    revalidatePath(`/projects/${id}`)
  }
  return result
}

export async function deleteProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const result = await deleteProject(read(formData, 'id'), email)
  if (!result.ok) return result
  revalidatePath('/projects')
  redirect('/projects')
}

export async function updateProjectStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')
  const result = await updateProjectStatus(id, read(formData, 'status'), email)
  if (result.ok) {
    revalidatePath('/projects')
    revalidatePath(`/projects/${id}`)
  }
  return result
}

export async function addMilestoneAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const projectId = read(formData, 'projectId')
  const result = await addMilestone(
    projectId,
    { name: read(formData, 'name'), dueOn: read(formData, 'dueOn') },
    email,
  )
  if (result.ok) revalidatePath(`/projects/${projectId}`)
  return result
}

export async function updateMilestoneAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const result = await updateMilestone(
    read(formData, 'id'),
    { name: read(formData, 'name'), dueOn: read(formData, 'dueOn') },
    email,
  )
  if (result.ok) revalidatePath(`/projects/${read(formData, 'projectId')}`)
  return result
}

export async function deleteMilestoneAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const result = await deleteMilestone(read(formData, 'id'), email)
  if (result.ok) revalidatePath(`/projects/${read(formData, 'projectId')}`)
  return result
}

export async function toggleMilestoneAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const result = await toggleMilestoneDone(read(formData, 'id'), email)
  if (result.ok) revalidatePath(`/projects/${read(formData, 'projectId')}`)
  return result
}

/* ------------------------------------------------------------------ */
/* 轉維運 / 專案報價                                                     */
/* ------------------------------------------------------------------ */

/** 轉維運表單：每種服務類型一列，勾選 include_<type> 才建立 */
export async function submitHandoverAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')
  const items = HANDOVER_TYPES.filter((t) => formData.get(`include_${t}`) === 'on').map((t) => ({
    type: t,
    identifier: read(formData, `identifier_${t}`),
    expiresAt: read(formData, `expiresAt_${t}`),
    priceAmount: read(formData, `price_${t}`),
    billingCycle: read(formData, `cycle_${t}`),
  }))
  const result = await submitHandover(
    id,
    { items, siteName: read(formData, 'siteName'), siteUrl: read(formData, 'siteUrl') },
    email,
  )
  if (!result.ok) return result
  revalidatePath(`/projects/${id}`)
  redirect(`/sites/${result.siteId}`)
}

/** 專案報價：表單有固定幾列，全空的列略過 */
export async function createProjectQuoteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')
  const rows = formData.getAll('description').map((_, i) => ({
    description: String(formData.getAll('description')[i] ?? ''),
    quantity: String(formData.getAll('quantity')[i] ?? ''),
    unit: String(formData.getAll('unit')[i] ?? ''),
    unitPrice: String(formData.getAll('unitPrice')[i] ?? ''),
    planId: String(formData.getAll('planId')[i] ?? ''),
  }))
  const items = rows.filter((r) => r.description.trim() || r.unitPrice.trim() || r.planId)
  const result = await createProjectQuote(id, items, email)
  if (!result.ok) return result
  revalidatePath(`/projects/${id}`)
  revalidatePath('/quotes')
  redirect(`/quotes/${result.quoteId}`)
}
