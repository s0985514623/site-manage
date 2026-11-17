import { beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '@/db'
import { quotes } from '@/db/schema'
import { renderQuotePdf } from '@/lib/pdf/render'
import { updateSettings } from '@/lib/settings'
import { deleteStamp, saveStamp } from '@/server/stamps'

import { 有客戶, 有網站, 網站id, 客戶id } from '../../support/given'

/** 記錄傳進報價單 PDF 的用印（PDF 內是圖片，直接比對傳入的 data URI） */
const pdf = vi.hoisted(() => ({ stamps: undefined as undefined | { company?: string; person?: string } }))
vi.mock('@/lib/pdf/QuoteDocument', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/pdf/QuoteDocument')>()
  return {
    ...original,
    QuoteDocument: (props: Parameters<typeof original.QuoteDocument>[0]) => {
      pdf.stamps = props.stamps
      return original.QuoteDocument(props)
    },
  }
})

const OWNER = 'owner@example.com'
// 兩張內容不同、可被 PDF 解碼的 1x1 PNG
const PNG_A = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const PNG_B = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

const png = (name: string, data = PNG_A) => new File([data], name, { type: 'image/png' })
const 已上傳 = (kind: 'company' | 'person', name: string, data = PNG_A) => saveStamp(kind, png(name, data), OWNER)

async function 產生報價單PDF() {
  await 有客戶('小森咖啡')
  await 有網站('小森咖啡官網', '小森咖啡')
  const [q] = await db
    .insert(quotes)
    .values({
      quoteNo: '261117',
      clientId: await 客戶id('小森咖啡'),
      siteId: await 網站id('小森咖啡官網'),
      issueDate: '2026-11-17',
      validUntil: '2026-12-01',
      anchorDate: '2026-12-20',
    })
    .returning()
  const result = await renderQuotePdf(q.id)
  expect(result.buffer.subarray(0, 4).toString()).toBe('%PDF')
  return pdf.stamps ?? {}
}

const dataUri = (data: Buffer) => `data:image/png;base64,${data.toString('base64')}`

describe('設定報價單用印', () => {
  beforeEach(() => {
    pdf.stamps = undefined
  })

  it.each([
    { kind: 'company', file: new File([Buffer.from('%PDF-1.4 x')], '大章.pdf', { type: 'application/pdf' }) },
    {
      kind: 'company',
      file: new File([Buffer.concat([PNG_A, Buffer.alloc(2 * 1024 * 1024)])], '超過 2MB 的大章.png', { type: 'image/png' }),
    },
    { kind: 'other', file: png('大章.png') },
  ])('檔案格式或大小不符時操作失敗：$file.name', async ({ kind, file }) => {
    const r = await saveStamp(kind, file, OWNER)
    expect(r.violationType).toBe('INVALID_ARGUMENT')
  })

  it('重新上傳大章時取代舊檔', async () => {
    await 已上傳('company', '舊大章.png', PNG_A)
    const r = await 已上傳('company', '新大章.png', PNG_B)
    expect(r.ok).toBe(true)
    const rows = await db.query.stamps.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0].data.equals(PNG_B)).toBe(true)
  })

  it('已上傳大小章時 PDF 帶入用印', async () => {
    await 已上傳('company', '大章.png', PNG_A)
    await 已上傳('person', '小章.png', PNG_B)
    expect(await 產生報價單PDF()).toEqual({ company: dataUri(PNG_A), person: dataUri(PNG_B) })
  })

  it('關閉自動用印時 PDF 不帶入用印', async () => {
    await 已上傳('company', '大章.png')
    await updateSettings({ stampEnabled: false })
    expect(await 產生報價單PDF()).toEqual({})
  })

  it('只上傳大章時 PDF 只帶入大章', async () => {
    await 已上傳('company', '大章.png')
    expect(await 產生報價單PDF()).toEqual({ company: dataUri(PNG_A) })
  })

  it('刪除小章後 PDF 不再帶入小章', async () => {
    await 已上傳('company', '大章.png', PNG_A)
    await 已上傳('person', '小章.png', PNG_B)
    const r = await deleteStamp('person', OWNER)
    expect(r.ok).toBe(true)
    expect(await 產生報價單PDF()).toEqual({ company: dataUri(PNG_A) })
  })
})
