import { asc, eq, max } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { projectMilestones, projects } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { fail, formError, type ActionState } from '@/server/actions/helpers'
import { removeProjectEvent, syncMilestone } from './calendar'

/** 每個專案可有多個自訂里程碑（名稱 + 日期），每個都寫入「專案管理」日曆 */

const milestoneSchema = z.object({
  name: z.string().trim().min(1, '請填寫里程碑名稱'),
  dueOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, '請選擇里程碑日期'),
})

export type MilestoneInput = { name: string; dueOn: string }

export async function addMilestone(
  projectId: string,
  input: MilestoneInput,
  actor: string,
): Promise<ActionState & { milestoneId?: string }> {
  const parsed = milestoneSchema.safeParse({ name: input.name ?? '', dueOn: input.dueOn ?? '' })
  if (!parsed.success) return formError(parsed.error)

  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) })
  if (!project) return fail('NOT_FOUND', '找不到這個專案')

  const [{ last }] = await db
    .select({ last: max(projectMilestones.sortOrder) })
    .from(projectMilestones)
    .where(eq(projectMilestones.projectId, projectId))

  const [row] = await db
    .insert(projectMilestones)
    .values({ projectId, ...parsed.data, sortOrder: (last ?? -1) + 1 })
    .returning()
  await syncMilestone(row.id)
  await logActivity(actor, 'milestone.created', 'project', projectId, { name: row.name })
  return { ok: true, milestoneId: row.id }
}

export async function updateMilestone(
  milestoneId: string,
  input: MilestoneInput,
  actor: string,
): Promise<ActionState> {
  const parsed = milestoneSchema.safeParse({ name: input.name ?? '', dueOn: input.dueOn ?? '' })
  if (!parsed.success) return formError(parsed.error)

  const [row] = await db
    .update(projectMilestones)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(projectMilestones.id, milestoneId))
    .returning()
  if (!row) return fail('NOT_FOUND', '找不到這個里程碑')

  await syncMilestone(row.id)
  await logActivity(actor, 'milestone.updated', 'project', row.projectId, { name: row.name })
  return { ok: true }
}

export async function deleteMilestone(milestoneId: string, actor: string): Promise<ActionState> {
  const [row] = await db
    .delete(projectMilestones)
    .where(eq(projectMilestones.id, milestoneId))
    .returning()
  if (!row) return fail('NOT_FOUND', '找不到這個里程碑')

  await removeProjectEvent(row.gcalEventId)
  await logActivity(actor, 'milestone.deleted', 'project', row.projectId, { name: row.name })
  return { ok: true }
}

/** 標記完成（再按一次取消完成）。日曆事件保留不刪 */
export async function toggleMilestoneDone(milestoneId: string, actor: string): Promise<ActionState> {
  const current = await db.query.projectMilestones.findFirst({
    where: eq(projectMilestones.id, milestoneId),
  })
  if (!current) return fail('NOT_FOUND', '找不到這個里程碑')

  const completedAt = current.completedAt ? null : new Date()
  await db
    .update(projectMilestones)
    .set({ completedAt, updatedAt: new Date() })
    .where(eq(projectMilestones.id, milestoneId))
  await logActivity(actor, completedAt ? 'milestone.completed' : 'milestone.reopened', 'project', current.projectId, {
    name: current.name,
  })
  return { ok: true }
}

export async function listMilestones(projectId: string) {
  return db.query.projectMilestones.findMany({
    where: eq(projectMilestones.projectId, projectId),
    orderBy: [asc(projectMilestones.dueOn), asc(projectMilestones.sortOrder)],
  })
}
