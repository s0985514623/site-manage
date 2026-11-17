import { asc, eq, max, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { projectMilestones, projects } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { fail, formError, type ActionState } from '@/server/actions/helpers'
import { removeProjectEvent, syncMilestone } from './calendar'

/**
 * 每個專案可自由新增多段時程與里程碑，每個都寫入「專案管理」日曆。
 *   時程：名稱 + 開始日 + 結束日（前端開發 11/20–12/10），日曆上是跨日事件
 *   里程碑：名稱 + 單一日期（設計稿確認），開始日留空
 */

const milestoneSchema = z.object({
  name: z.string().trim().min(1, '請填寫名稱'),
  startOn: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), '開始日格式需為 YYYY-MM-DD'),
  dueOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, '請選擇日期'),
})

export type MilestoneInput = { name: string; dueOn: string; startOn?: string }

/** 驗證並換成資料表欄位；開始日晚於結束日回 INVALID_DATE_RANGE */
function parse(input: MilestoneInput): { data: { name: string; startOn: string | null; dueOn: string } } | { error: ActionState } {
  const parsed = milestoneSchema.safeParse({
    name: input.name ?? '',
    startOn: input.startOn ?? '',
    dueOn: input.dueOn ?? '',
  })
  if (!parsed.success) return { error: formError(parsed.error) }
  const { name, startOn, dueOn } = parsed.data
  if (startOn && startOn > dueOn) {
    return { error: fail('INVALID_DATE_RANGE', '開始日不可晚於結束日') }
  }
  // 開始日與結束日同一天就當作單日里程碑
  return { data: { name, startOn: startOn && startOn !== dueOn ? startOn : null, dueOn } }
}

export async function addMilestone(
  projectId: string,
  input: MilestoneInput,
  actor: string,
): Promise<ActionState & { milestoneId?: string }> {
  const parsed = parse(input)
  if ('error' in parsed) return parsed.error

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
  const parsed = parse(input)
  if ('error' in parsed) return parsed.error

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
    // 依開始日（里程碑用當天）排序，時程與里程碑照時間先後混排
    orderBy: [
      asc(sql`coalesce(${projectMilestones.startOn}, ${projectMilestones.dueOn})`),
      asc(projectMilestones.dueOn),
      asc(projectMilestones.sortOrder),
    ],
  })
}
