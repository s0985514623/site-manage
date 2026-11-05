import { currentUserEmail } from '@/auth'
import { logActivity } from '@/lib/activity'
import { renderQuotePdf } from '@/lib/pdf/render'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 下載報價單 PDF。
 *
 * 需要登入：報價單含客戶名稱、統編與金額，不該讓任何人憑 id 猜到就能取得。
 * 加上 ?download=1 會觸發下載而非在瀏覽器內預覽。
 */
export async function GET(
  request: Request,
  { params }: RouteContext<'/api/quotes/[id]/pdf'>,
) {
  const email = await currentUserEmail()
  if (!email) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const { buffer, filename } = await renderQuotePdf(id)
    const download = new URL(request.url).searchParams.get('download') === '1'

    await logActivity(email, 'quote.pdf_viewed', 'quote', id)

    return new Response(new Uint8Array(buffer), {
      headers: {
        'content-type': 'application/pdf',
        // 中文檔名需用 RFC 5987 的 filename* 編碼，否則部分瀏覽器會變成亂碼
        'content-disposition':
          `${download ? 'attachment' : 'inline'}; ` +
          `filename="quote-${id}.pdf"; ` +
          `filename*=UTF-8''${encodeURIComponent(filename)}`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return Response.json({ error: message }, { status: 404 })
  }
}
