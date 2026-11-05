import { eq } from 'drizzle-orm'

import { currentUserEmail } from '@/auth'
import { db } from '@/db'
import { quoteAttachments } from '@/db/schema'
import { logActivity } from '@/lib/activity'

export const dynamic = 'force-dynamic'

/**
 * 下載報價單附件。
 *
 * 需要登入：回簽的報價單上有客戶的簽名與用印，不該讓任何人憑 id 猜到就能取得。
 * 加上 ?download=1 觸發下載而非在瀏覽器內預覽。
 */
export async function GET(
  request: Request,
  { params }: RouteContext<'/api/attachments/[id]'>,
) {
  const email = await currentUserEmail()
  if (!email) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const row = await db.query.quoteAttachments.findFirst({
    where: eq(quoteAttachments.id, id),
  })
  if (!row) return Response.json({ error: 'not found' }, { status: 404 })

  await logActivity(email, 'attachment.downloaded', 'quote', row.quoteId, {
    filename: row.filename,
  })

  const download = new URL(request.url).searchParams.get('download') === '1'

  return new Response(new Uint8Array(row.data), {
    headers: {
      'content-type': row.contentType,
      'content-length': String(row.sizeBytes),
      // 中文檔名需 RFC 5987 編碼，否則部分瀏覽器會變成亂碼
      'content-disposition':
        `${download ? 'attachment' : 'inline'}; ` +
        `filename="attachment-${id}"; ` +
        `filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      /**
       * 這些檔案含客戶簽名與用印，不讓中繼快取留存；
       * 同時關掉瀏覽器的內容類型猜測，避免被當成可執行內容。
       */
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
