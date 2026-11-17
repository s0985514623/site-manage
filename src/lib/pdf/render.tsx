import { renderToBuffer } from '@react-pdf/renderer'
import { asc, desc, eq } from 'drizzle-orm'

import { db } from '@/db'
import { contacts, quoteItems, quotes } from '@/db/schema'
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
    filename: `報價單_${quote.quoteNo}_${quote.client.name}.pdf`,
  }
}
