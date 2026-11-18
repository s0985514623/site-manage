import { beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '@/db'
import { plans, quotes } from '@/db/schema'
import { quotePdfFilename, renderQuotePdf } from '@/lib/pdf/render'
import { createProjectQuote, type ProjectQuoteItemInput } from '@/server/projects/quote'

import { fakeNet } from '../../fakes/network'
import { 客戶id, 專案id, 有客戶, 有專案, 有網站, 系統設定為, 網站id } from '../../support/given'

/** 記錄傳進報價單 PDF 的資料（PDF 內嵌字型子集，無法直接從檔案抽出中文） */
const pdfProps = vi.hoisted(() => ({ last: null as null | { quote: { siteName: string } } }))
vi.mock('@/lib/pdf/QuoteDocument', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/pdf/QuoteDocument')>()
  return {
    ...original,
    QuoteDocument: (props: Parameters<typeof original.QuoteDocument>[0]) => {
      pdfProps.last = props as never
      return original.QuoteDocument(props)
    },
  }
})

const OWNER = 'owner@example.com'

async function 管理者從專案產生報價草稿(project: string, items: ProjectQuoteItemInput[]) {
  return createProjectQuote(await 專案id(project), items, OWNER)
}

async function 最新一張報價單(project: string) {
  return db.query.quotes.findFirst({
    where: (t, { eq }) => eq(t.projectId, project),
    orderBy: (t, { desc }) => [desc(t.createdAt), desc(t.quoteNo)],
    with: { items: true },
  })
}

describe('從專案產生報價草稿', () => {
  beforeEach(async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true })
    await 有客戶('青禾設計')
    await 有客戶('小森咖啡')
    await 有網站('小森咖啡官網', '小森咖啡')
    await 有專案({ name: '青禾新官網', client: '青禾設計', category: 'new_site', status: 'not_started', dueDate: '2026-12-31' })
    await 有專案({ name: '會員集點外掛', client: '小森咖啡', site: '小森咖啡官網', category: 'custom_plugin', status: 'completed', startDate: '2026-10-01', dueDate: '2026-10-31' })
  })

  it.each([
    { description: '', quantity: '1', unitPrice: '50000' },
    { description: '官網設計製作', quantity: '0', unitPrice: '50000' },
    { description: '官網設計製作', quantity: '1', unitPrice: '-1' },
  ])('報價項目不合法時操作失敗：%o', async (row) => {
    const r = await 管理者從專案產生報價草稿('青禾新官網', [{ ...row, unit: '式' }])
    expect(r.violationType).toBe('INVALID_ARGUMENT')
  })

  it('沒有任何報價項目時操作失敗', async () => {
    const r = await 管理者從專案產生報價草稿('青禾新官網', [])
    expect(r.violationType).toBe('INVALID_ARGUMENT')
  })

  it.each(['青禾新官網', '會員集點外掛'])('不同狀態的專案都能產生報價草稿：%s', async (project) => {
    const r = await 管理者從專案產生報價草稿(project, [{ description: '追加功能', quantity: '1', unit: '式', unitPrice: '8000' }])
    expect(r.ok).toBe(true)
  })

  it('已有報價單的專案可再產生一張', async () => {
    await db.insert(quotes).values({
      quoteNo: '261105',
      clientId: await 客戶id('青禾設計'),
      projectId: await 專案id('青禾新官網'),
      status: 'sent',
      sentAt: new Date('2026-11-05T10:00:00+08:00'),
      issueDate: '2026-11-05',
      validUntil: '2026-11-19',
      total: '126000',
    })
    const r = await 管理者從專案產生報價草稿('青禾新官網', [{ description: '追加多語系', quantity: '1', unit: '式', unitPrice: '15000' }])
    expect(r.ok).toBe(true)
    const projectId = await 專案id('青禾新官網')
    const all = await db.query.quotes.findMany({ where: (t, { eq }) => eq(t.projectId, projectId) })
    expect(all).toHaveLength(2)
  })

  it('從方案範本帶入的項目可調整單價', async () => {
    const [plan] = await db.insert(plans).values({ name: '基本方案', type: 'hosting', specNote: '空間 10GB', priceAmount: '6000' }).returning()
    const r = await 管理者從專案產生報價草稿('青禾新官網', [
      { description: '主機 基本方案', quantity: '1', unit: '年', unitPrice: '5400', planId: plan.id },
    ])
    expect(r.ok).toBe(true)
    const q = await 最新一張報價單(await 專案id('青禾新官網'))
    expect(
      q!.items.map((i) => ({
        description: i.description,
        spec_note: i.specNote,
        quantity: Number(i.quantity),
        unit: i.unit,
        unit_price: Number(i.unitPrice),
        amount: Number(i.amount),
      })),
    ).toEqual([{ description: '主機 基本方案', spec_note: '空間 10GB', quantity: 1, unit: '年', unit_price: 5400, amount: 5400 }])
  })

  it.each([
    { project: '青禾新官網', client: '青禾設計', site: '' },
    { project: '會員集點外掛', client: '小森咖啡', site: '小森咖啡官網' },
  ])('產生的報價單客戶與網站正確：$project', async ({ project, client, site }) => {
    const r = await 管理者從專案產生報價草稿(project, [{ description: '專案費用', quantity: '1', unit: '式', unitPrice: '50000' }])
    expect(r.ok).toBe(true)
    const q = await 最新一張報價單(await 專案id(project))
    expect(q).toMatchObject({
      clientId: await 客戶id(client),
      siteId: site ? await 網站id(site) : null,
      anchorDate: null,
      subtotal: '50000.00',
    })
  })

  it('報價單的專案名稱為專案名稱', async () => {
    await 管理者從專案產生報價草稿('青禾新官網', [{ description: '官網設計製作', quantity: '1', unit: '式', unitPrice: '50000' }])
    const q = await 最新一張報價單(await 專案id('青禾新官網'))
    expect(q?.projectName).toBe('青禾新官網')
    expect(
      quotePdfFilename({ ...q!, project: { name: '青禾新官網' }, client: { name: '青禾設計' }, site: null }),
    ).toBe(`青禾新官網報價單v${q!.quoteNo}.pdf`)
  })

  it('產生的報價單為草稿且有效期限依設定', async () => {
    await 管理者從專案產生報價草稿('青禾新官網', [{ description: '官網設計製作', quantity: '1', unit: '式', unitPrice: '50000' }])
    const q = await 最新一張報價單(await 專案id('青禾新官網'))
    expect(q).toMatchObject({ status: 'draft', issueDate: '2026-11-16', validUntil: '2026-11-30' })
    expect(fakeNet.calls('line')).toHaveLength(0)
  })

  it('未綁網站的報價單 PDF 顯示專案名稱', async () => {
    const r = await 管理者從專案產生報價草稿('青禾新官網', [{ description: '官網設計製作', quantity: '1', unit: '式', unitPrice: '50000' }])
    const pdf = await renderQuotePdf(r.quoteId!)
    expect(pdf.buffer.subarray(0, 4).toString()).toBe('%PDF')
    expect(pdfProps.last?.quote.siteName).toBe('青禾新官網')
  })
})
