import { asc, eq } from 'drizzle-orm'

import { db } from '@/db'
import { projects, sites, updateImages, updates } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { checkUploadFile, type CheckedFile } from '@/lib/upload-file'
import { fail, type ActionState } from '@/server/actions/helpers'

/**
 * 近況：專案或網站底下依時間排列的對話串，每則可帶文字與多張圖片。
 *
 * 圖片直接存資料庫（bytea），跟回簽報價單一樣隨資料庫備份。
 * 頁面上的圖片在瀏覽器內顯示，所以只收瀏覽器都能直接顯示的格式。
 */

export type UpdateTarget = { projectId: string } | { siteId: string }

export const MAX_UPDATE_IMAGES = 10
/** 一則訊息所有圖片合計上限；Server Action 的請求上限是 12MB（next.config.ts） */
export const MAX_UPDATE_TOTAL_BYTES = 10 * 1024 * 1024
export const MAX_UPDATE_BODY = 5000

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function targetExists(target: UpdateTarget): Promise<boolean> {
  if ('projectId' in target) {
    if (!UUID.test(target.projectId)) return false
    return Boolean(
      await db.query.projects.findFirst({ where: eq(projects.id, target.projectId), columns: { id: true } }),
    )
  }
  if (!UUID.test(target.siteId)) return false
  return Boolean(await db.query.sites.findFirst({ where: eq(sites.id, target.siteId), columns: { id: true } }))
}

export async function addUpdate(
  target: UpdateTarget,
  input: { body: string; images: File[] },
  actor: string,
): Promise<ActionState & { updateId?: string }> {
  const body = (input.body ?? '').trim()
  const images = (input.images ?? []).filter((f) => f.size > 0)

  if (!body && images.length === 0) return fail('INVALID_ARGUMENT', '請輸入訊息或附上圖片')
  if (body.length > MAX_UPDATE_BODY) {
    return fail('INVALID_ARGUMENT', `訊息最多 ${MAX_UPDATE_BODY} 字`)
  }
  if (images.length > MAX_UPDATE_IMAGES) {
    return fail('INVALID_ARGUMENT', `一則訊息最多 ${MAX_UPDATE_IMAGES} 張圖片`)
  }
  const totalBytes = images.reduce((sum, f) => sum + f.size, 0)
  if (totalBytes > MAX_UPDATE_TOTAL_BYTES) {
    return fail('INVALID_ARGUMENT', '圖片合計超過 10MB，請分成多則訊息傳送')
  }

  const checked: CheckedFile[] = []
  for (const file of images) {
    const r = await checkUploadFile(file)
    if (!r.ok) return fail('INVALID_ARGUMENT', `${file.name}：${r.error}`)
    if (!IMAGE_TYPES.has(r.file.contentType)) {
      return fail('INVALID_ARGUMENT', `${file.name}：只接受 JPG、PNG、WebP 圖片（iPhone 的 HEIC 請先轉成 JPG）`)
    }
    checked.push(r.file)
  }

  if (!(await targetExists(target))) {
    return fail('NOT_FOUND', 'projectId' in target ? '找不到這個專案' : '找不到這個網站')
  }

  const row = await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(updates)
      .values({
        projectId: 'projectId' in target ? target.projectId : null,
        siteId: 'siteId' in target ? target.siteId : null,
        body,
        createdBy: actor,
        // 用應用程式的時鐘而非資料庫 now()，排序與測試的「今天是」一致
        createdAt: new Date(),
      })
      .returning({ id: updates.id })
    if (checked.length > 0) {
      await tx.insert(updateImages).values(
        checked.map((f, i) => ({
          updateId: u.id,
          filename: f.filename,
          contentType: f.contentType,
          sizeBytes: f.size,
          data: f.buffer,
          sortOrder: i,
        })),
      )
    }
    return u
  })

  await logActivity(
    actor,
    'update.added',
    'projectId' in target ? 'project' : 'site',
    'projectId' in target ? target.projectId : target.siteId,
    { updateId: row.id, images: checked.length },
  )
  return { ok: true, updateId: row.id }
}

export async function deleteUpdate(id: string, actor: string): Promise<ActionState> {
  if (!UUID.test(id)) return fail('NOT_FOUND', '找不到這則近況')
  const [row] = await db
    .delete(updates)
    .where(eq(updates.id, id))
    .returning({ projectId: updates.projectId, siteId: updates.siteId })
  if (!row) return fail('NOT_FOUND', '找不到這則近況')
  await logActivity(
    actor,
    'update.deleted',
    row.projectId ? 'project' : 'site',
    row.projectId ?? row.siteId,
    { updateId: id },
  )
  return { ok: true }
}

/** 依時間由舊到新（對話串，最新在最下面）。不讀圖片本體 */
export async function listUpdates(target: UpdateTarget) {
  return db.query.updates.findMany({
    where:
      'projectId' in target
        ? eq(updates.projectId, target.projectId)
        : eq(updates.siteId, target.siteId),
    orderBy: [asc(updates.createdAt), asc(updates.id)],
    with: {
      images: {
        columns: { id: true, filename: true, contentType: true, sizeBytes: true },
        orderBy: [asc(updateImages.sortOrder)],
      },
    },
  })
}

export type UpdateWithImages = Awaited<ReturnType<typeof listUpdates>>[number]
