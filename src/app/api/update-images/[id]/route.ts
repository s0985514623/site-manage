import { eq } from 'drizzle-orm'

import { currentUserEmail } from '@/auth'
import { db } from '@/db'
import { updateImages } from '@/db/schema'

export const dynamic = 'force-dynamic'

/**
 * 近況圖片。需要登入：施工截圖可能含客戶後台畫面。
 * 圖片上傳後不會改，所以允許瀏覽器私有快取，捲動對話串不必每次重抓。
 */
export async function GET(_request: Request, { params }: RouteContext<'/api/update-images/[id]'>) {
  const email = await currentUserEmail()
  if (!email) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: 'not found' }, { status: 404 })

  const row = await db.query.updateImages.findFirst({ where: eq(updateImages.id, id) })
  if (!row) return Response.json({ error: 'not found' }, { status: 404 })

  return new Response(new Uint8Array(row.data), {
    headers: {
      'content-type': row.contentType,
      'content-length': String(row.sizeBytes),
      'content-disposition': `inline; filename="image-${id}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  })
}
