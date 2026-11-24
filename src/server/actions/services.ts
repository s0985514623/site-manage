'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { requireUser } from '@/auth'
import { db } from '@/db'
import { plans, services } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { advanceByCycle, type BillingCycle } from '@/lib/dates'
import { encrypt } from '@/lib/crypto'
import { removeServiceEvent, syncService } from '@/server/gcal-sync'
import { formError, type ActionState } from './helpers'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const serviceSchema = z.object({
  siteId: z.string().uuid(),
  type: z.enum([
    'domain',
    'hosting',
    'ssl',
    'maintenance',
    'email',
    'license',
    'cdn',
    'other',
  ]),
  identifier: z.string().trim().min(1, '請填寫項目名稱（網域名稱／主機方案／外掛名）'),
  provider: z.string().trim(),
  providerAccount: z.string().trim(),
  isOurs: z.boolean(),
  startedAt: z
    .string()
    .trim()
    .refine((v) => v === '' || DATE_RE.test(v), '開始日格式需為 YYYY-MM-DD'),
  expiresAt: z.string().trim().regex(DATE_RE, '請填寫到期日'),
  billingCycle: z.enum([
    'monthly',
    'quarterly',
    'yearly',
    'biennial',
    'triennial',
  ]),
  autoRenew: z.boolean(),
  costAmount: z.string().trim(),
  priceAmount: z.string().trim(),
  currency: z.string().trim().min(1),
  detectHost: z.string().trim(),
  mailbox: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), '檢查信箱格式需為 name@example.com'),
  dkimSelector: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[a-z0-9._-]+$/i.test(v), 'DKIM selector 只能有英數字、點、底線與連字號'),
  planId: z.string().trim(),
  specNote: z.string().trim(),
  note: z.string().trim(),
})

function read(formData: FormData, key: string): string {
  const v = formData.get(key)
  return typeof v === 'string' ? v : ''
}

function readBool(formData: FormData, key: string): boolean {
  return formData.get(key) === 'on' || formData.get(key) === 'true'
}

function money(value: string): string | null {
  if (value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return n.toFixed(2)
}

function parseForm(formData: FormData) {
  return serviceSchema.safeParse({
    siteId: read(formData, 'siteId'),
    type: read(formData, 'type') || 'other',
    identifier: read(formData, 'identifier'),
    provider: read(formData, 'provider'),
    providerAccount: read(formData, 'providerAccount'),
    isOurs: readBool(formData, 'isOurs'),
    startedAt: read(formData, 'startedAt'),
    expiresAt: read(formData, 'expiresAt'),
    billingCycle: read(formData, 'billingCycle') || 'yearly',
    autoRenew: readBool(formData, 'autoRenew'),
    costAmount: read(formData, 'costAmount'),
    priceAmount: read(formData, 'priceAmount'),
    currency: read(formData, 'currency') || 'TWD',
    detectHost: read(formData, 'detectHost'),
    mailbox: read(formData, 'mailbox'),
    dkimSelector: read(formData, 'dkimSelector'),
    planId: read(formData, 'planId'),
    specNote: read(formData, 'specNote'),
    note: read(formData, 'note'),
  })
}

export async function saveService(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')

  const parsed = parseForm(formData)
  if (!parsed.success) return formError(parsed.error)
  const d = parsed.data

  // 網域轉移用的 EPP / Auth Code 屬敏感資料，一律加密後再落地
  const authCodeInput = read(formData, 'authCode').trim()
  const authCodeEncrypted = authCodeInput
    ? JSON.stringify(encrypt(authCodeInput))
    : undefined

  /**
   * 售價留空但選了方案範本 → 帶入方案的預設售價。
   * 落地成服務項目自己的售價，報價單、到期掃描、日曆等所有讀 priceAmount
   * 的地方就不必各自再回退一次。之後改方案價不會回頭改已存的項目。
   */
  let priceAmount = money(d.priceAmount)
  if (priceAmount === null && d.planId) {
    const plan = await db.query.plans.findFirst({
      where: eq(plans.id, d.planId),
      columns: { priceAmount: true },
    })
    priceAmount = plan?.priceAmount ?? null
  }

  const values = {
    siteId: d.siteId,
    type: d.type,
    identifier: d.identifier,
    provider: d.provider || null,
    providerAccount: d.providerAccount || null,
    isOurs: d.isOurs,
    startedAt: d.startedAt || null,
    expiresAt: d.expiresAt,
    billingCycle: d.billingCycle,
    autoRenew: d.autoRenew,
    costAmount: money(d.costAmount),
    priceAmount,
    currency: d.currency,
    detectHost: d.detectHost || null,
    mailbox: d.mailbox || null,
    dkimSelector: d.dkimSelector || null,
    planId: d.planId || null,
    // 自訂規格會覆蓋方案範本；留空則報價時回退到方案的內容
    specNote: d.specNote || null,
    note: d.note || null,
    updatedAt: new Date(),
    ...(authCodeEncrypted ? { authCodeEncrypted } : {}),
  }

  let serviceId = id
  if (id) {
    await db.update(services).set(values).where(eq(services.id, id))
  } else {
    const [row] = await db.insert(services).values(values).returning()
    serviceId = row.id
  }

  await logActivity(
    email,
    id ? 'service.updated' : 'service.created',
    'service',
    serviceId,
    { identifier: d.identifier, type: d.type, expiresAt: d.expiresAt },
  )

  /**
   * 同步日曆，但失敗不擋存檔 —— Google API 掛掉不該害你存不了資料。
   * 漏掉的由每日對帳（/api/cron/gcal-sync）補上。
   */
  if (serviceId) await syncService(serviceId)

  revalidatePath(`/sites/${d.siteId}`)
  revalidatePath('/services')
  return { ok: true }
}

export async function deleteService(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')
  const siteId = read(formData, 'siteId')

  // 先把日曆事件清掉，否則刪完就查不到 gcalEventId 了
  const existing = await db.query.services.findFirst({
    where: eq(services.id, id),
  })
  await removeServiceEvent(existing?.gcalEventId ?? null)

  await db.delete(services).where(eq(services.id, id))
  await logActivity(email, 'service.deleted', 'service', id, { siteId })

  revalidatePath(`/sites/${siteId}`)
  revalidatePath('/services')
  return { ok: true }
}

/**
 * 標記為已續約：把到期日依「各自的」計費週期往前推一個週期，
 * 並把續約狀態重置回 upcoming，讓下一個年度重新走一次流程。
 *
 * 刻意以資料庫裡的現值為基準推算，而不是用表單傳來的日期，
 * 避免頁面停留過久造成以過期的畫面資料覆寫。
 */
export async function markRenewed(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')
  const siteId = read(formData, 'siteId')

  const service = await db.query.services.findFirst({
    where: eq(services.id, id),
  })
  if (!service) return { error: '找不到這個服務項目' }

  const next = advanceByCycle(
    service.expiresAt,
    service.billingCycle as BillingCycle,
  )

  await db
    .update(services)
    .set({
      expiresAt: next,
      startedAt: service.expiresAt,
      status: 'active',
      renewalState: 'upcoming',
      currentQuoteId: null,
      updatedAt: new Date(),
    })
    .where(eq(services.id, id))

  await logActivity(email, 'service.renewed', 'service', id, {
    from: service.expiresAt,
    to: next,
    cycle: service.billingCycle,
  })

  // 到期日變了，日曆事件要跟著移動
  await syncService(id)

  revalidatePath(`/sites/${siteId}`)
  revalidatePath('/services')
  return { ok: true }
}

/**
 * 採用 WHOIS / TLS 偵測到的到期日。
 * 偵測結果預設不覆蓋人工值，必須由你確認後才套用 —— 解析錯誤的
 * 到期日會直接導致報價單在錯的時間、用錯的金額寄出去。
 */
export async function acceptDetectedDate(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const id = read(formData, 'id')
  const siteId = read(formData, 'siteId')

  const service = await db.query.services.findFirst({
    where: eq(services.id, id),
  })
  if (!service?.detectedExpiresAt) {
    return { error: '這個項目沒有偵測到的到期日可套用' }
  }

  await db
    .update(services)
    .set({ expiresAt: service.detectedExpiresAt, updatedAt: new Date() })
    .where(eq(services.id, id))

  await logActivity(email, 'service.accepted_detected_date', 'service', id, {
    from: service.expiresAt,
    to: service.detectedExpiresAt,
    source: service.detectSource,
  })

  await syncService(id)

  revalidatePath(`/sites/${siteId}`)
  revalidatePath('/services')
  return { ok: true }
}
