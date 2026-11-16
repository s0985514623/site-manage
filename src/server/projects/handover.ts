import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { billingCycleEnum, projects, services, serviceTypeEnum, sites } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { syncService } from '@/server/gcal-sync'
import { fail, formError, type ActionState } from '@/server/actions/helpers'

/**
 * 新網站專案完成 → 轉維運：建立（或沿用）網站並設為已上線、依表單建立服務項目。
 *
 * 只能做一次：交易內以 handover_completed_at IS NULL 條件更新搶下專案，
 * 送出兩次時第二次會失敗（HANDOVER_NOT_ALLOWED），不會建出重複的服務項目。
 */

const itemSchema = z.object({
  type: z.enum(serviceTypeEnum.enumValues, '服務類型不正確'),
  identifier: z.string().trim().min(1, '請填寫服務項目名稱'),
  expiresAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, '請填寫到期日'),
  priceAmount: z
    .string()
    .trim()
    .min(1, '請填寫售價')
    .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, '售價不可為負數'),
  billingCycle: z.enum(billingCycleEnum.enumValues).default('yearly'),
})

const handoverSchema = z.object({
  items: z.array(itemSchema).min(1, '請至少勾選一個服務項目'),
  siteName: z.string().trim().optional(),
  siteUrl: z
    .string()
    .trim()
    .refine((v) => v === '' || /^https?:\/\/.+/.test(v), '網址需以 http:// 或 https:// 開頭')
    .optional(),
})

export type HandoverItemInput = {
  type: string
  identifier: string
  expiresAt: string
  priceAmount: string
  billingCycle?: string
}

export type HandoverInput = {
  items: HandoverItemInput[]
  /** 專案沒綁網站時新建網站用；留空帶專案名稱 */
  siteName?: string
  siteUrl?: string
}

export async function submitHandover(
  projectId: string,
  input: HandoverInput,
  actor: string,
): Promise<ActionState & { siteId?: string; serviceIds?: string[] }> {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) })
  if (!project) return fail('NOT_FOUND', '找不到這個專案')
  if (project.category !== 'new_site' || project.status !== 'completed' || project.handoverCompletedAt) {
    return fail('HANDOVER_NOT_ALLOWED', '只有已完成、尚未轉維運的新網站專案可以轉維運')
  }

  const parsed = handoverSchema.safeParse({
    items: (input.items ?? []).map((i) => ({ ...i, billingCycle: i.billingCycle || undefined })),
    siteName: input.siteName ?? '',
    siteUrl: input.siteUrl ?? '',
  })
  if (!parsed.success) return formError(parsed.error)
  const d = parsed.data

  const result = await db.transaction(async (tx) => {
    // 搶佔：同時送出兩次時只有一次會更新到列
    const [claimed] = await tx
      .update(projects)
      .set({ handoverCompletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), isNull(projects.handoverCompletedAt)))
      .returning()
    if (!claimed) return null

    let siteId = project.siteId
    if (siteId) {
      await tx.update(sites).set({ status: 'live', updatedAt: new Date() }).where(eq(sites.id, siteId))
    } else {
      const [site] = await tx
        .insert(sites)
        .values({
          clientId: project.clientId,
          name: d.siteName || project.name,
          primaryUrl: d.siteUrl || null,
          status: 'live',
        })
        .returning()
      siteId = site.id
      await tx.update(projects).set({ siteId }).where(eq(projects.id, projectId))
    }

    const created = await tx
      .insert(services)
      .values(
        d.items.map((i) => ({
          siteId: siteId!,
          type: i.type,
          identifier: i.identifier,
          expiresAt: i.expiresAt,
          priceAmount: Number(i.priceAmount).toFixed(2),
          billingCycle: i.billingCycle,
          status: 'active' as const,
          renewalState: 'upcoming' as const,
          isOurs: true,
          sourceProjectId: projectId,
        })),
      )
      .returning({ id: services.id })

    return { siteId: siteId!, serviceIds: created.map((s) => s.id) }
  })

  if (!result) return fail('HANDOVER_NOT_ALLOWED', '這個專案已經轉維運過了')

  // 到期事件寫入「網站到期管理」日曆（盡力而為，失敗由每日對帳補）
  for (const id of result.serviceIds) await syncService(id)
  await logActivity(actor, 'project.handover', 'project', projectId, {
    siteId: result.siteId,
    services: result.serviceIds.length,
  })
  return { ok: true, ...result }
}
