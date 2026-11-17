import { currentUserEmail } from '@/auth'
import { isStampKind, stampImage } from '@/server/stamps'

export const dynamic = 'force-dynamic'

/** 設定頁預覽用印圖檔。需要登入：章的圖檔不該讓任何人取得 */
export async function GET(_request: Request, { params }: RouteContext<'/api/stamps/[kind]'>) {
  const email = await currentUserEmail()
  if (!email) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { kind } = await params
  if (!isStampKind(kind)) return Response.json({ error: 'not found' }, { status: 404 })
  const row = await stampImage(kind)
  if (!row) return Response.json({ error: 'not found' }, { status: 404 })

  return new Response(new Uint8Array(row.data), {
    headers: {
      'content-type': row.contentType,
      'cache-control': 'private, no-store',
    },
  })
}
