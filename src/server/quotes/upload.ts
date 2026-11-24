import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { projects, quoteFiles, quotes, sites } from '@/db/schema'
import { logActivity } from '@/lib/activity'
import { plusDays, today } from '@/lib/dates'
import { fromCents, toCents } from '@/lib/money'
import { nextQuoteNo } from '@/lib/quote-no'
import { getSettings } from '@/lib/settings'
import { checkUploadFile } from '@/lib/upload-file'
import { fail, type ActionState } from '@/server/actions/helpers'

/**
 * 上傳外部做好的報價單 PDF，建成一張正式報價單。
 *
 * 與系統產生的報價單共用寄送、追蹤未回覆、登記收款流程；差別是沒有明細，
 * 「檢視 PDF」與寄信附件都直接用上傳的檔案（見 renderQuotePdf）。
 * 已經自己寄給客戶的，可以勾「已寄出」直接進入追蹤。
 */

export type UploadQuoteInput = {
  projectId?: string
  siteId?: string
  file: File
  /** 留空 = 依開立日自動編號（YYMMDD） */
  quoteNo?: string
  /** 報價單標題；留空 = 專案名稱 / 網站名稱 */
  title?: string
  issueDate?: string
  validUntil?: string
  /** 合計（含稅後客戶要付的金額） */
  total: string
  alreadySent?: boolean
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function uploadQuote(
  input: UploadQuoteInput,
  actor: string,
): Promise<ActionState & { quoteId?: string }> {
  const projectId = input.projectId?.trim() || undefined
  const siteId = input.siteId?.trim() || undefined
  if (!projectId && !siteId) return fail('INVALID_ARGUMENT', '報價單必須掛在專案或網站底下')

  if (!(input.file instanceof File) || input.file.size === 0) {
    return fail('INVALID_ARGUMENT', '請選擇報價單 PDF')
  }
  const totalRaw = (input.total ?? '').trim().replace(/,/g, '')
  const totalNum = Number(totalRaw)
  if (!totalRaw || !Number.isFinite(totalNum) || totalNum <= 0) {
    return fail('INVALID_ARGUMENT', '合計金額必須大於 0')
  }

  const issueDate = input.issueDate?.trim() || today()
  if (!DATE.test(issueDate)) return fail('INVALID_ARGUMENT', '開立日期格式不正確')
  const validRaw = input.validUntil?.trim()
  if (validRaw && !DATE.test(validRaw)) return fail('INVALID_ARGUMENT', '有效期限格式不正確')

  const quoteNoInput = input.quoteNo?.trim()
  if (quoteNoInput && !/^[\w-]{1,40}$/.test(quoteNoInput)) {
    return fail('INVALID_ARGUMENT', '單號只能用英數字、底線或減號（最多 40 字）')
  }

  const checked = await checkUploadFile(input.file)
  if (!checked.ok) return fail('INVALID_ARGUMENT', checked.error)
  // 會當成寄信附件，只收 PDF
  if (checked.file.contentType !== 'application/pdf') {
    return fail('INVALID_ARGUMENT', '報價單只接受 PDF 檔')
  }

  // 專案優先：專案的網站、客戶跟著專案走
  let clientId: string
  let resolvedSiteId: string | null
  let defaultTitle: string
  let currency = 'TWD'
  if (projectId) {
    const project = UUID.test(projectId)
      ? await db.query.projects.findFirst({ where: eq(projects.id, projectId) })
      : undefined
    if (!project) return fail('NOT_FOUND', '找不到這個專案')
    clientId = project.clientId
    resolvedSiteId = project.siteId
    defaultTitle = project.name
    currency = project.currency
  } else {
    const site = UUID.test(siteId!)
      ? await db.query.sites.findFirst({ where: eq(sites.id, siteId!) })
      : undefined
    if (!site) return fail('NOT_FOUND', '找不到這個網站')
    clientId = site.clientId
    resolvedSiteId = site.id
    defaultTitle = site.name
  }

  const config = await getSettings()
  const validUntil = validRaw || plusDays(issueDate, config.quoteValidDays)
  if (validUntil < issueDate) return fail('INVALID_DATE_RANGE', '有效期限不可早於開立日期')

  if (quoteNoInput) {
    const taken = await db.query.quotes.findFirst({
      where: eq(quotes.quoteNo, quoteNoInput),
      columns: { id: true },
    })
    if (taken) return fail('QUOTE_NO_TAKEN', `單號 ${quoteNoInput} 已經有報價單使用`)
  }

  const total = fromCents(toCents(totalRaw))
  const sent = Boolean(input.alreadySent)

  let row: { id: string; quoteNo: string }
  try {
    row = await db.transaction(async (tx) => {
      const quoteNo = quoteNoInput || (await nextQuoteNo(tx, issueDate))
      const [q] = await tx
        .insert(quotes)
        .values({
          quoteNo,
          source: 'uploaded',
          projectName: input.title?.trim() || defaultTitle,
          clientId,
          siteId: resolvedSiteId,
          projectId: projectId ?? null,
          status: sent ? 'sent' : 'draft',
          sentAt: sent ? new Date() : null,
          issueDate,
          validUntil,
          currency,
          // 上傳的 PDF 已經算好稅，系統只記合計
          taxMode: 'none',
          subtotal: total,
          taxAmount: '0',
          total,
        })
        .returning({ id: quotes.id, quoteNo: quotes.quoteNo })
      await tx.insert(quoteFiles).values({
        quoteId: q.id,
        filename: checked.file.filename,
        contentType: checked.file.contentType,
        sizeBytes: checked.file.size,
        data: checked.file.buffer,
        uploadedBy: actor,
      })
      return q
    })
  } catch (error) {
    // 同時有人用了同一個單號（quote_no 唯一索引）
    const e = error as { code?: string; cause?: { code?: string } }
    if (e?.code === '23505' || e?.cause?.code === '23505') {
      return fail('QUOTE_NO_TAKEN', '單號剛好被另一張報價單使用，請再試一次')
    }
    throw error
  }

  await logActivity(actor, 'quote.uploaded', 'quote', row.id, {
    quoteNo: row.quoteNo,
    projectId: projectId ?? null,
    siteId: resolvedSiteId,
    filename: checked.file.filename,
    alreadySent: sent,
  })
  return { ok: true, quoteId: row.id }
}
