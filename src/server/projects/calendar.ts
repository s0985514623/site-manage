import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { projectMilestones, projects } from '@/db/schema'
import { allDay, deleteCalendarEvent, GcalFailure, upsertCalendarEvent } from '@/lib/gcal'
import { env } from '@/lib/env'

/**
 * 專案 / 里程碑 → 「專案管理」日曆（單向）。
 *
 * 盡力而為：Google 失敗或尚未授權都不擋存檔（規格：日曆同步失敗不阻擋），
 * 事件 id 留空，由每日 gcal-sync 對帳補上。
 */

async function loadProject(projectId: string) {
  return db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    with: { client: true },
  })
}

function clientLabel(client: { name: string; shortName: string | null }) {
  return client.shortName || client.name
}

function warn(what: string, error: unknown) {
  if (error instanceof GcalFailure && error.detail.kind === 'not_configured') return
  console.warn(`[gcal] ${what} 同步失敗：${error instanceof Error ? error.message : error}`)
}

/** 讓專案截止日事件與資料庫一致：有截止日就建立 / 更新，沒有就刪除 */
export async function syncProjectDue(projectId: string): Promise<void> {
  const project = await loadProject(projectId)
  if (!project) return
  try {
    if (!project.dueDate) {
      if (project.gcalEventId) {
        await deleteCalendarEvent('project', project.gcalEventId)
        await db.update(projects).set({ gcalEventId: null }).where(eq(projects.id, projectId))
      }
      return
    }
    const eventId = await upsertCalendarEvent(
      'project',
      {
        summary: `【專案截止】${clientLabel(project.client)} · ${project.name}`,
        description: `後台：${env.APP_URL}/projects/${project.id}`,
        ...allDay(project.dueDate),
        extendedProperties: { private: { siteSupportProjectId: project.id } },
        transparency: 'transparent',
      },
      project.gcalEventId,
    )
    if (eventId !== project.gcalEventId) {
      await db.update(projects).set({ gcalEventId: eventId }).where(eq(projects.id, projectId))
    }
  } catch (error) {
    warn(`專案 ${project.name}`, error)
  }
}

/** 讓里程碑事件與資料庫一致。完成後事件保留（規格） */
export async function syncMilestone(milestoneId: string): Promise<void> {
  const milestone = await db.query.projectMilestones.findFirst({
    where: eq(projectMilestones.id, milestoneId),
    with: { project: { with: { client: true } } },
  })
  if (!milestone) return
  const { project } = milestone
  try {
    const eventId = await upsertCalendarEvent(
      'project',
      {
        summary: `【里程碑】${clientLabel(project.client)} · ${project.name} · ${milestone.name}`,
        description: `後台：${env.APP_URL}/projects/${project.id}`,
        ...allDay(milestone.dueOn),
        extendedProperties: { private: { siteSupportMilestoneId: milestone.id } },
        transparency: 'transparent',
      },
      milestone.gcalEventId,
    )
    if (eventId !== milestone.gcalEventId) {
      await db
        .update(projectMilestones)
        .set({ gcalEventId: eventId })
        .where(eq(projectMilestones.id, milestoneId))
    }
  } catch (error) {
    warn(`里程碑 ${milestone.name}`, error)
  }
}

/** 刪除專案或里程碑時清掉事件；清不掉不擋刪除 */
export async function removeProjectEvent(eventId: string | null): Promise<void> {
  if (!eventId) return
  try {
    await deleteCalendarEvent('project', eventId)
  } catch (error) {
    warn('刪除事件', error)
  }
}

/** 每日對帳：補上同步失敗、還沒有事件 id 的專案與里程碑 */
export async function reconcileProjectCalendar(limit = 200) {
  const pendingProjects = await db.query.projects.findMany({
    columns: { id: true, dueDate: true, gcalEventId: true },
    limit,
  })
  let synced = 0
  for (const p of pendingProjects) {
    if (p.dueDate || p.gcalEventId) {
      await syncProjectDue(p.id)
      synced++
    }
  }
  const milestones = await db.query.projectMilestones.findMany({ columns: { id: true }, limit })
  for (const m of milestones) {
    await syncMilestone(m.id)
    synced++
  }
  return { synced }
}
