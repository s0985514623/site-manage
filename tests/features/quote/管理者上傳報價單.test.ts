import { beforeEach, describe, expect, it } from 'vitest'

import { renderQuotePdf } from '@/lib/pdf/render'
import { updateSettings } from '@/lib/settings'
import { uploadQuote, type UploadQuoteInput } from '@/server/quotes/upload'
import { sendQuoteToClient } from '@/server/send-quote'

import { fakeNet } from '../../fakes/network'
import { 今天是 } from '../../support/clock'
import {
  報價單,
  有報價單,
  有報價收件人,
  有客戶,
  有專案,
  有網站,
  專案id,
  客戶id,
  網站id,
  系統設定為,
} from '../../support/given'

const OWNER = 'owner@example.com'
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n')
const pdf = (name: string) => new File([PDF_BYTES], name, { type: 'application/pdf' })

async function 在專案上傳(opts: Partial<UploadQuoteInput> & { total: string }) {
  return uploadQuote({ projectId: await 專案id('官網改版'), file: pdf('報價.pdf'), ...opts }, OWNER)
}

describe('管理者上傳報價單', () => {
  beforeEach(async () => {
    今天是('2026-11-24')
    await 有客戶('小森咖啡')
    await 有網站('小森咖啡官網', '小森咖啡')
    await 有專案({ name: '官網改版', client: '小森咖啡', category: 'new_site', site: '小森咖啡官網' })
    await updateSettings({ quoteValidDays: 14 })
  })

  it('非 PDF 檔案時操作失敗', async () => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    const r = await 在專案上傳({ total: '30000', file: new File([PNG], '報價.png', { type: 'image/png' }) })
    expect(r.violationType).toBe('INVALID_ARGUMENT')
  })

  it.each(['0', '-100', 'abc'])('合計金額不大於 0 時操作失敗：%s', async (total) => {
    const r = await 在專案上傳({ total })
    expect(r.violationType).toBe('INVALID_ARGUMENT')
  })

  it('有效期限早於開立日期時操作失敗', async () => {
    const r = await 在專案上傳({ total: '30000', issueDate: '2026-11-24', validUntil: '2026-11-20' })
    expect(r.violationType).toBe('INVALID_DATE_RANGE')
  })

  it('單號已被使用時操作失敗', async () => {
    await 有報價單({ quote_no: '261124', client: '小森咖啡', site: '小森咖啡官網', status: 'draft', valid_until: '2026-12-08', total: '100' })
    const r = await 在專案上傳({ total: '30000', quoteNo: '261124' })
    expect(r.violationType).toBe('QUOTE_NO_TAKEN')
  })

  it('在專案上傳報價單 PDF 建立草稿', async () => {
    const r = await 在專案上傳({ total: '30000' })
    expect(r.ok).toBe(true)
    const q = await 報價單('261124')
    expect(q).toMatchObject({
      source: 'uploaded',
      status: 'draft',
      clientId: await 客戶id('小森咖啡'),
      siteId: await 網站id('小森咖啡官網'),
      projectId: await 專案id('官網改版'),
      projectName: '官網改版',
      total: '30000.00',
      issueDate: '2026-11-24',
      validUntil: '2026-12-08',
      sentAt: null,
    })
  })

  it('在網站上傳報價單 PDF 建立草稿', async () => {
    const r = await uploadQuote(
      { siteId: await 網站id('小森咖啡官網'), file: pdf('續約.pdf'), total: '8400', quoteNo: 'A-2026-01' },
      OWNER,
    )
    expect(r.ok).toBe(true)
    expect(await 報價單('A-2026-01')).toMatchObject({
      source: 'uploaded',
      status: 'draft',
      clientId: await 客戶id('小森咖啡'),
      siteId: await 網站id('小森咖啡官網'),
      projectId: null,
      projectName: '小森咖啡官網',
      total: '8400.00',
    })
  })

  it('勾選已寄出時直接標記為已寄出', async () => {
    const r = await 在專案上傳({ total: '30000', alreadySent: true })
    expect(r.ok).toBe(true)
    const q = await 報價單('261124')
    expect(q?.status).toBe('sent')
    expect(q?.sentAt).toBeInstanceOf(Date)
  })

  it('檢視 PDF 時回傳上傳的原檔', async () => {
    const r = await 在專案上傳({ total: '30000' })
    const out = await renderQuotePdf(r.quoteId!)
    expect(out.buffer.equals(PDF_BYTES)).toBe(true)
    expect(out.filename).toBe('官網改版報價單v261124.pdf')
  })

  it('寄出上傳的報價單時附上原檔', async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true })
    await 有報價收件人('小森咖啡', 'boss@morimori.tw')
    const up = await 在專案上傳({ total: '30000' })
    const r = await sendQuoteToClient(up.quoteId!, OWNER)
    expect(r.ok).toBe(true)
    const mails = fakeNet.mails() as unknown as Array<{
      to: string[]
      attachments?: Array<{ filename: string; content: unknown }>
    }>
    expect(mails).toHaveLength(1)
    expect(mails[0].to).toEqual(['boss@morimori.tw'])
    const att = mails[0].attachments?.[0]
    expect(att?.filename).toBe('官網改版報價單v261124.pdf')
    const content = att?.content
    const bytes =
      typeof content === 'string'
        ? Buffer.from(content, 'base64')
        : Buffer.from((content as { data: number[] }).data)
    expect(bytes.equals(PDF_BYTES)).toBe(true)
  })
})
