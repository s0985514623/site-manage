import { and, asc, count, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import {
  clients,
  projectCategoryEnum,
  projectMilestones,
  projects,
  projectStatusEnum,
  quotes,
  sites,
  type Project,
} from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { today } from '@/lib/dates'
import { fail, formError, type ActionState } from '@/server/actions/helpers'
import { removeProjectEvent, syncProjectDue } from './calendar'

/**
 * 專案的業務邏輯（建立 / 編輯 / 刪除 / 狀態 / 列表）。
 * 不碰 FormData 與快取：Server Action 與 LINE 快速新增都呼叫這裡，測試也直接呼叫這裡。
 */

export type ProjectCategory = (typeof projectCategoryEnum.enumValues)[number]
export type ProjectStatus = (typeof projectStatusEnum.enumValues)[number]

export const CATEGORY_LABEL: Record<ProjectCategory, string> = {
  new_site: '新網站',
  custom_plugin: '客製化外掛',
  bug_fix: 'BUG 排除',
  other: '其他',
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  not_started: '待開始',
  in_progress: '進行中',
  in_review: '待驗收',
  completed: '已完成',
}

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), '日期格式需為 YYYY-MM-DD')
const optionalUuid = z
  .string()
  .trim()
  .refine((v) => v === '' || z.uuid().safeParse(v).success, '選項不正確')

const projectSchema = z.object({
  name: z.string().trim().min(1, '請填寫專案名稱'),
  clientId: z.uuid('請選擇客戶'),
  category: z.enum(projectCategoryEnum.enumValues, '請選擇專案類別'),
  siteId: optionalUuid,
  startDate: optionalDate,
  dueDate: optionalDate,
  description: z.string().trim(),
  estimatedAmount: z
    .string()
    .trim()
    .refine((v) => v === '' || (Number.isFinite(Number(v)) && Number(v) >= 0), '預估金額不可為負數'),
})

export type ProjectInput = {
  name: string
  clientId: string
  category: string
  siteId?: string
  startDate?: string
  dueDate?: string
  description?: string
  estimatedAmount?: string
}

type Validated = z.infer<typeof projectSchema>

/** 參數 → 日期區間 → 客戶 → 網站，依規格的前置條件順序檢查 */
async function validate(input: ProjectInput): Promise<{ data: Validated } | { error: ActionState }> {
  const parsed = projectSchema.safeParse({
    name: input.name ?? '',
    clientId: input.clientId ?? '',
    category: input.category ?? '',
    siteId: input.siteId ?? '',
    startDate: input.startDate ?? '',
    dueDate: input.dueDate ?? '',
    description: input.description ?? '',
    estimatedAmount: input.estimatedAmount ?? '',
  })
  if (!parsed.success) return { error: formError(parsed.error) }
  const d = parsed.data

  if (d.startDate && d.dueDate && d.dueDate < d.startDate) {
    return { error: fail('INVALID_DATE_RANGE', '截止日不可早於開始日') }
  }

  const client = await db.query.clients.findFirst({ where: eq(clients.id, d.clientId) })
  if (!client) return { error: fail('NOT_FOUND', '找不到這個客戶') }
  if (client.status !== 'active') return { error: fail('CLIENT_INACTIVE', '這個客戶已停用') }

  if (d.siteId) {
    const site = await db.query.sites.findFirst({ where: eq(sites.id, d.siteId) })
    if (!site) return { error: fail('NOT_FOUND', '找不到這個網站') }
    if (site.clientId !== d.clientId) {
      return { error: fail('SITE_CLIENT_MISMATCH', '網站不屬於這個客戶') }
    }
  }
  return { data: d }
}

function toColumns(d: Validated) {
  return {
    name: d.name,
    clientId: d.clientId,
    category: d.category,
    siteId: d.siteId || null,
    startDate: d.startDate || null,
    dueDate: d.dueDate || null,
    description: d.description || null,
    estimatedAmount: d.estimatedAmount === '' ? null : Number(d.estimatedAmount).toFixed(2),
  }
}

export async function createProject(
  input: ProjectInput,
  actor: string,
): Promise<ActionState & { projectId?: string }> {
  const result = await validate(input)
  if ('error' in result) return result.error

  const [row] = await db.insert(projects).values(toColumns(result.data)).returning()
  await syncProjectDue(row.id)
  await logActivity(actor, 'project.created', 'project', row.id, { name: row.name })
  return { ok: true, projectId: row.id }
}

/** 編輯：沒傳的欄位維持原值 */
export async function updateProject(
  projectId: string,
  patch: Partial<ProjectInput>,
  actor: string,
): Promise<ActionState> {
  const current = await db.query.projects.findFirst({ where: eq(projects.id, projectId) })
  if (!current) return fail('NOT_FOUND', '找不到這個專案')

  const merged: ProjectInput = {
    name: patch.name ?? current.name,
    clientId: patch.clientId ?? current.clientId,
    category: patch.category ?? current.category,
    siteId: patch.siteId ?? current.siteId ?? '',
    startDate: patch.startDate ?? current.startDate ?? '',
    dueDate: patch.dueDate ?? current.dueDate ?? '',
    description: patch.description ?? current.description ?? '',
    estimatedAmount: patch.estimatedAmount ?? current.estimatedAmount ?? '',
  }
  const result = await validate(merged)
  if ('error' in result) return result.error

  await db
    .update(projects)
    .set({ ...toColumns(result.data), updatedAt: new Date() })
    .where(eq(projects.id, projectId))
  await syncProjectDue(projectId)
  await logActivity(actor, 'project.updated', 'project', projectId, { name: result.data.name })
  return { ok: true }
}

export async function deleteProject(projectId: string, actor: string): Promise<ActionState> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    with: { milestones: true },
  })
  if (!project) return fail('NOT_FOUND', '找不到這個專案')

  const [{ n }] = await db.select({ n: count() }).from(quotes).where(eq(quotes.projectId, projectId))
  if (n > 0) return fail('PROJECT_HAS_QUOTES', '這個專案已有報價單，不能刪除')

  await removeProjectEvent(project.gcalEventId)
  for (const m of project.milestones) await removeProjectEvent(m.gcalEventId)
  // 里程碑隨 FK cascade 刪除
  await db.delete(projects).where(eq(projects.id, projectId))
  await logActivity(actor, 'project.deleted', 'project', projectId, { name: project.name })
  return { ok: true }
}

/**
 * 四個狀態可任意切換。「新網站」第一次變成已完成時回傳 handoverRequired，
 * 由畫面接著顯示轉維運表單（送出見 handover.ts）。
 */
export async function updateProjectStatus(
  projectId: string,
  status: string,
  actor: string,
): Promise<ActionState & { status?: ProjectStatus; handoverRequired?: boolean }> {
  const parsed = z.enum(projectStatusEnum.enumValues).safeParse(status)
  if (!parsed.success) return fail('INVALID_ARGUMENT', '專案狀態不正確')

  const [row] = await db
    .update(projects)
    .set({ status: parsed.data, updatedAt: new Date() })
    .where(eq(projects.id, projectId))
    .returning()
  if (!row) return fail('NOT_FOUND', '找不到這個專案')

  await logActivity(actor, 'project.status_changed', 'project', projectId, { status: row.status })
  return { ok: true, status: row.status, handoverRequired: handoverRequired(row) }
}

export function handoverRequired(p: Pick<Project, 'category' | 'status' | 'handoverCompletedAt'>) {
  return p.category === 'new_site' && p.status === 'completed' && !p.handoverCompletedAt
}

export type ProjectListRow = {
  id: string
  name: string
  clientId: string
  clientName: string
  category: ProjectCategory
  status: ProjectStatus
  dueDate: string | null
  overdue: boolean
  handoverPending: boolean
  milestoneCount: number
}

/** 依截止日由近到遠，未設截止日排最後 */
export async function listProjects(
  filter: { category?: string; status?: string; clientId?: string } = {},
): Promise<ProjectListRow[]> {
  const conditions = []
  const category = z.enum(projectCategoryEnum.enumValues).safeParse(filter.category)
  if (category.success) conditions.push(eq(projects.category, category.data))
  const status = z.enum(projectStatusEnum.enumValues).safeParse(filter.status)
  if (status.success) conditions.push(eq(projects.status, status.data))
  if (filter.clientId) conditions.push(eq(projects.clientId, filter.clientId))

  const rows = await db
    .select({
      project: projects,
      clientName: clients.name,
      milestoneCount: sql<number>`(select count(*)::int from ${projectMilestones} where ${projectMilestones.projectId} = ${projects.id})`,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(sql`${projects.dueDate} asc nulls last`, asc(projects.name))

  const now = today()
  return rows.map(({ project: p, clientName, milestoneCount }) => ({
    id: p.id,
    name: p.name,
    clientId: p.clientId,
    clientName,
    category: p.category,
    status: p.status,
    dueDate: p.dueDate,
    overdue: Boolean(p.dueDate && p.dueDate < now && p.status !== 'completed'),
    handoverPending: handoverRequired(p),
    milestoneCount,
  }))
}
