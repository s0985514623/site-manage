import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { stamps } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { getSettings, updateSettings } from '@/lib/settings'
import { checkUploadFile } from '@/lib/upload-file'
import { fail, type ActionState } from '@/server/actions/helpers'

/**
 * 乙方用印：大章（公司章）、小章（負責人章）。
 * 報價單 PDF 的乙方「用印」欄自動蓋上；甲方欄位維持空白給客戶蓋。
 */

export type StampKind = 'company' | 'person'
export const STAMP_KINDS: StampKind[] = ['company', 'person']
export const STAMP_LABEL: Record<StampKind, string> = { company: '大章（公司章）', person: '小章（負責人章）' }

const MAX_STAMP_BYTES = 2 * 1024 * 1024
const ALLOWED = new Set(['image/png', 'image/jpeg'])

export function isStampKind(value: string): value is StampKind {
  return (STAMP_KINDS as string[]).includes(value)
}

export async function saveStamp(kind: string, file: File, actor: string): Promise<ActionState> {
  if (!isStampKind(kind)) return fail('INVALID_ARGUMENT', '章的種類不正確')
  if (file.size === 0) return fail('INVALID_ARGUMENT', '請選擇圖檔')
  if (file.size > MAX_STAMP_BYTES) return fail('INVALID_ARGUMENT', '圖檔超過 2MB，請縮小後再上傳')

  const checked = await checkUploadFile(file)
  if (!checked.ok) return fail('INVALID_ARGUMENT', checked.error)
  // PDF 用的是圖片，只收 PNG（建議透明背景）與 JPEG
  if (!ALLOWED.has(checked.file.contentType)) {
    return fail('INVALID_ARGUMENT', '只接受 PNG 或 JPEG 圖檔（建議去背的 PNG）')
  }

  const values = {
    kind,
    contentType: checked.file.contentType,
    sizeBytes: checked.file.size,
    data: checked.file.buffer,
    uploadedBy: actor,
    updatedAt: new Date(),
  }
  await db.insert(stamps).values(values).onConflictDoUpdate({ target: stamps.kind, set: values })
  await logActivity(actor, 'stamp.uploaded', 'settings', null, { kind, bytes: checked.file.size })
  return { ok: true }
}

export async function deleteStamp(kind: string, actor: string): Promise<ActionState> {
  if (!isStampKind(kind)) return fail('INVALID_ARGUMENT', '章的種類不正確')
  await db.delete(stamps).where(eq(stamps.kind, kind))
  await logActivity(actor, 'stamp.deleted', 'settings', null, { kind })
  return { ok: true }
}

export async function setStampEnabled(enabled: boolean, actor: string): Promise<ActionState> {
  await updateSettings({ stampEnabled: enabled })
  await logActivity(actor, 'settings.stamp_enabled', 'settings', null, { enabled })
  return { ok: true }
}

/** 已上傳的章（不含圖檔內容），給設定頁顯示 */
export async function stampStatus() {
  const rows = await db
    .select({ kind: stamps.kind, sizeBytes: stamps.sizeBytes, updatedAt: stamps.updatedAt })
    .from(stamps)
  return Object.fromEntries(rows.map((r) => [r.kind, r])) as Partial<
    Record<StampKind, { sizeBytes: number; updatedAt: Date }>
  >
}

/** 報價單 PDF 用：自動用印開啟時回傳 data URI，關閉或沒上傳回傳空物件 */
export async function stampsForPdf(): Promise<Partial<Record<StampKind, string>>> {
  const config = await getSettings()
  if (!config.stampEnabled) return {}
  const rows = await db.select().from(stamps)
  return Object.fromEntries(
    rows.map((r) => [r.kind, `data:${r.contentType};base64,${r.data.toString('base64')}`]),
  )
}

export async function stampImage(kind: StampKind) {
  return db.query.stamps.findFirst({ where: eq(stamps.kind, kind) })
}
