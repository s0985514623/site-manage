import { renderToBuffer } from '@react-pdf/renderer'
import { asc, desc, eq } from 'drizzle-orm'

import { db } from '@/db'
import { contacts, quoteFiles, quoteItems, quotes } from '@/db/schema'
import { quoteSubjectName } from '../quote-display'
import { stampsForPdf } from '@/server/stamps'
import { getSettings } from '../settings'
import { QuoteDocument } from './QuoteDocument'

/**
 * 產生報價單 PDF。
 *
 * 每次都即時渲染而不快取：報價單在寄出前可能被編輯，
 * 而寄出錯誤版本的 PDF 比慢幾秒嚴重得多。
 */
export async function renderQuotePdf(quoteId: string): Promise<{
  buffer: Buffer
  filename: string
}> {
  const quote = await db.query.quotes.findFirst({
    where: eq(quotes.id, quoteId),
    with: {
      client: true,
      site: true,
      project: true,
      items: { orderBy: [asc(quoteItems.sortOrder)] },
    },
  })
  if (!quote) throw new Error(`找不到報價單 ${quoteId}`)

  // 上傳的報價單：檢視與寄信都用原檔，不重新排版
  if (quote.source === 'uploaded') {
    const file = await db.query.quoteFiles.findFirst({ where: eq(quoteFiles.quoteId, quoteId) })
    if (!file) throw new Error(`報價單 ${quote.quoteNo} 的上傳檔案不見了`)
    return { buffer: Buffer.from(file.data), filename: quotePdfFilename(quote) }
  }

  const settings = await getSettings()

  /**
   * 報價單上的「聯絡人」欄取主要聯絡人；沒設主要的話退而求其次
   * 取任何一位收報價單的窗口，讓這一格不至於空白。
   */
  const contact = await db.query.contacts.findFirst({
    where: eq(contacts.clientId, quote.clientId),
    orderBy: [desc(contacts.isPrimary), desc(contacts.receiveQuotes)],
  })

  const stamps = await stampsForPdf()

  const buffer = await renderToBuffer(
    <QuoteDocument
      stamps={stamps}
      quote={{ ...quote, siteName: quoteSubjectName(quote) }}
      settings={settings}
      contact={contact ?? undefined}
    />,
  )

  return {
    buffer: Buffer.from(buffer),
    filename: quotePdfFilename(quote),
  }
}

/**
 * PDF 檔名。
 * - 專案報價：「<專案名稱>報價單v<單號>.pdf」
 * - 續約報價（綁網站、非專案）：「<網站名稱>續約報價單v<單號>.pdf」
 * 檔名中不能出現的字元（/ \ : * ? " < > |）換成底線。
 */
export function quotePdfFilename(quote: {
  quoteNo: string
  projectId: string | null
  project?: { name: string } | null
  client: { name: string }
  site: { name: string } | null
}): string {
  const name = quote.projectId
    ? `${quote.project?.name ?? quote.client.name}報價單v${quote.quoteNo}`
    : quote.site
      ? `${quote.site.name}續約報價單v${quote.quoteNo}`
      : `報價單v${quote.quoteNo}_${quote.client.name}`
  return `${name.replace(/[\\/:*?"<>|]/g, '_')}.pdf`
}
