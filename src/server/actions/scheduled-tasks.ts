'use server'

import { revalidatePath } from 'next/cache'

import { requireUser } from '@/auth'
import {
  deleteScheduledTask,
  runScheduledTaskNow,
  saveScheduledTask,
  type ScheduledTaskInput,
} from '@/server/ops/scheduled-tasks'
import type { ActionState } from './helpers'

const FIELDS = [
  'id',
  'name',
  'kind',
  'job',
  'message',
  'url',
  'method',
  'frequency',
  'intervalMinutes',
  'timeOfDay',
  'weekday',
  'dayOfMonth',
] as const

function read(formData: FormData, key: string): string {
  const v = formData.get(key)
  return typeof v === 'string' ? v : ''
}

export async function saveScheduledTaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const input: ScheduledTaskInput = Object.fromEntries(FIELDS.map((k) => [k, read(formData, k)]))
  input.enabled = formData.get('enabled') === 'on'
  const result = await saveScheduledTask(input, email)
  if (result.ok) revalidatePath('/settings')
  return result
}

export async function deleteScheduledTaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const result = await deleteScheduledTask(read(formData, 'id'), email)
  if (result.ok) revalidatePath('/settings')
  return result
}

export async function runScheduledTaskNowAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const result = await runScheduledTaskNow(read(formData, 'id'), email)
  revalidatePath('/settings')
  return result
}
