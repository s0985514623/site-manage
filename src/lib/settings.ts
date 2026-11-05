import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { settings, type Settings } from '@/db/schema'

/**
 * 系統設定固定為單一列（id = 1）。
 * 第一次讀取時自動建立，省掉一套初始化流程。
 */
export async function getSettings(): Promise<Settings> {
  const existing = await db.query.settings.findFirst({
    where: eq(settings.id, 1),
  })
  if (existing) return existing

  const [created] = await db
    .insert(settings)
    .values({ id: 1 })
    .onConflictDoNothing()
    .returning()

  // 併發情況下另一個請求可能先插入成功，這時重讀一次
  if (created) return created
  const row = await db.query.settings.findFirst({ where: eq(settings.id, 1) })
  if (!row) throw new Error('無法建立系統設定列')
  return row
}

export async function updateSettings(
  patch: Partial<Omit<Settings, 'id' | 'updatedAt'>>,
): Promise<Settings> {
  await getSettings()
  const [row] = await db
    .update(settings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(settings.id, 1))
    .returning()
  return row
}
