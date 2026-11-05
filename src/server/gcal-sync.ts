import { and, eq, isNotNull, ne } from 'drizzle-orm'

import { db } from '@/db'
import { clients, services, sites } from '@/db/schema'
import { GcalFailure, deleteEvent, upsertEvent } from '@/lib/gcal'

/**
 * 服務項目與 Google Calendar 事件的同步。
 *
 * 同步是「盡力而為」：API 會失敗、授權會過期，但那些都不該讓使用者
 * 存不了服務項目。所以單筆同步的錯誤只記錄不拋出，改由每日對帳補上。
 */

export type SyncOutcome =
  | { ok: true; eventId: string | null; action: 'upsert' | 'delete' | 'skip' }
  | { ok: false; error: string; reauthRequired: boolean }

/** 只有這些狀態需要出現在日曆上 */
const SYNCABLE = ['active'] as const

async function loadService(serviceId: string) {
  const rows = await db
    .select({
      service: services,
      siteName: sites.name,
      siteId: sites.id,
      clientName: clients.name,
      clientShortName: clients.shortName,
    })
    .from(services)
    .innerJoin(sites, eq(services.siteId, sites.id))
    .innerJoin(clients, eq(sites.clientId, clients.id))
    .where(eq(services.id, serviceId))
    .limit(1)
  return rows[0] ?? null
}

/**
 * 讓某個服務項目的日曆事件與資料庫一致。
 *
 * 已終止或已過期的項目會把事件刪掉 —— 日曆上留著一堆不需要處理的
 * 舊到期日，很快就會讓人懶得看。
 */
export async function syncService(serviceId: string): Promise<SyncOutcome> {
  try {
    const row = await loadService(serviceId)
    if (!row) return { ok: true, eventId: null, action: 'skip' }

    const { service } = row
    const shouldExist = (SYNCABLE as readonly string[]).includes(service.status)

    if (!shouldExist) {
      if (service.gcalEventId) {
        await deleteEvent(service.gcalEventId)
        await db
          .update(services)
          .set({ gcalEventId: null })
          .where(eq(services.id, serviceId))
      }
      return { ok: true, eventId: null, action: 'delete' }
    }

    const eventId = await upsertEvent(
      {
        serviceId: service.id,
        clientName: row.clientShortName || row.clientName,
        siteName: row.siteName,
        siteId: row.siteId,
        type: service.type,
        identifier: service.identifier,
        expiresAt: service.expiresAt,
        billingCycle: service.billingCycle,
        provider: service.provider,
        priceAmount: service.priceAmount,
        currency: service.currency,
        isOurs: service.isOurs,
      },
      service.gcalEventId,
    )

    if (eventId !== service.gcalEventId) {
      await db
        .update(services)
        .set({ gcalEventId: eventId })
        .where(eq(services.id, serviceId))
    }

    return { ok: true, eventId, action: 'upsert' }
  } catch (cause) {
    const reauthRequired =
      cause instanceof GcalFailure && cause.detail.kind === 'reauth_required'
    const notConfigured =
      cause instanceof GcalFailure && cause.detail.kind === 'not_configured'

    // 還沒授權不算錯誤，只是功能沒啟用
    if (notConfigured) return { ok: true, eventId: null, action: 'skip' }

    return {
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
      reauthRequired,
    }
  }
}

/** 刪除服務項目前呼叫，把日曆上的事件一併清掉 */
export async function removeServiceEvent(
  gcalEventId: string | null,
): Promise<void> {
  if (!gcalEventId) return
  try {
    await deleteEvent(gcalEventId)
  } catch {
    // 事件清不掉不該擋住刪除本身，每日對帳會處理孤兒事件
  }
}

export type ReconcileResult = {
  synced: number
  removed: number
  failed: number
  reauthRequired: boolean
  errors: { identifier: string; error: string }[]
}

/**
 * 每日對帳。
 *
 * 逐筆寫入當下的 API 呼叫可能失敗（網路、配額、權杖剛好過期），
 * 只靠那一次會讓日曆悄悄失準。這裡把所有使用中的項目重跑一次，
 * 並清掉已終止項目殘留的事件。
 */
export async function reconcileCalendar(
  limit = 200,
): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    synced: 0,
    removed: 0,
    failed: 0,
    reauthRequired: false,
    errors: [],
  }

  const active = await db
    .select({ id: services.id, identifier: services.identifier })
    .from(services)
    .where(eq(services.status, 'active'))
    .limit(limit)

  for (const row of active) {
    const outcome = await syncService(row.id)
    if (outcome.ok) {
      if (outcome.action === 'upsert') result.synced++
      if (outcome.action === 'delete') result.removed++
    } else {
      result.failed++
      result.errors.push({ identifier: row.identifier, error: outcome.error })
      if (outcome.reauthRequired) {
        result.reauthRequired = true
        // 授權失效的話後面每一筆都會失敗，沒必要繼續打 API
        break
      }
    }
  }

  // 已終止／過期卻還留著日曆事件的項目，把事件清掉
  const stale = await db
    .select({ id: services.id, identifier: services.identifier })
    .from(services)
    .where(and(ne(services.status, 'active'), isNotNull(services.gcalEventId)))
    .limit(limit)

  for (const row of stale) {
    const outcome = await syncService(row.id)
    if (outcome.ok && outcome.action === 'delete') result.removed++
  }

  return result
}
