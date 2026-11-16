import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/db'
import { checkUploadFile } from '@/lib/upload-file'
import { registerPayment, type PaymentInput } from '@/server/quotes/payment'

import { 報價單, 報價單包含服務項目, 有報價單, 有客戶, 有服務項目, 有網站 } from '../../support/given'

const OWNER = 'owner@example.com'
type Status = 'draft' | 'pending_approval' | 'sent' | 'accepted' | 'cancelled'

async function 管理者登記收款(quoteNo: string, input: PaymentInput) {
  const q = await 報價單(quoteNo)
  return registerPayment(q!.id, input, OWNER)
}

const 小森報價 = (status: Status, extra: Partial<Parameters<typeof 有報價單>[0]> = {}) =>
  有報價單({
    quote_no: '261110',
    client: '小森咖啡',
    site: '小森咖啡官網',
    status,
    sent_at: status === 'sent' || status === 'accepted' ? '2026-11-10T10:00:00+08:00' : undefined,
    anchor_date: '2026-12-20',
    valid_until: '2026-11-24',
    total: '8400',
    ...extra,
  })

describe('登記收款', () => {
  beforeEach(async () => {
    await 有客戶('小森咖啡')
    await 有網站('小森咖啡官網', '小森咖啡')
  })

  it.each(['draft', 'pending_approval', 'cancelled'] as const)('報價單狀態不允許登記收款時操作失敗：%s', async (status) => {
    await 小森報價(status)
    const r = await 管理者登記收款('261110', { paidOn: '2026-11-15', paidAmount: '8400' })
    expect(r.violationType).toBe('INVALID_QUOTE_STATUS')
  })

  it('已收款的報價單再次登記時操作失敗', async () => {
    await 小森報價('accepted', { accepted_at: '2026-11-12T10:00:00+08:00', paid_on: '2026-11-14' })
    const r = await 管理者登記收款('261110', { paidOn: '2026-11-15', paidAmount: '8400' })
    expect(r.violationType).toBe('ALREADY_PAID')
  })

  it.each([
    { paidOn: '', paidAmount: '8400' },
    { paidOn: '2026-11-15', paidAmount: '' },
  ])('缺少必填欄位時操作失敗：%o', async (input) => {
    await 小森報價('sent')
    const r = await 管理者登記收款('261110', input)
    expect(r.violationType).toBe('INVALID_ARGUMENT')
  })

  it.each([
    { paidOn: '2026-11-15', paidAmount: '0' },
    { paidOn: '2026-11-15', paidAmount: '-100' },
    { paidOn: '2026-11-17', paidAmount: '8400' },
  ])('金額或日期超出範圍時操作失敗：%o', async (input) => {
    await 小森報價('sent')
    const r = await 管理者登記收款('261110', input)
    expect(r.violationType).toBe('INVALID_ARGUMENT')
  })

  it.each([
    { before: 'sent' as const, accepted_at: undefined },
    { before: 'accepted' as const, accepted_at: '2026-11-12T10:00:00+08:00' },
  ])('登記收款後報價單狀態與收款資料正確：$before', async ({ before, accepted_at }) => {
    await 小森報價(before, { accepted_at })
    const r = await 管理者登記收款('261110', { paidOn: '2026-11-16', paidAmount: '8370' })
    expect(r.ok).toBe(true)
    const q = await 報價單('261110')
    expect(q).toMatchObject({ status: 'accepted', paidOn: '2026-11-16', paidAmount: '8370.00' })
    // 原本已寄出的，同意時間記為登記當下；已同意的保留原時間
    expect(q?.acceptedAt?.toISOString()).toBe(new Date(accepted_at ?? '2026-11-16T10:00:00+08:00').toISOString())
  })

  it('附上匯款證明時附件一併保存', async () => {
    await 小森報價('sent')
    const png = new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])], '匯款明細.png', { type: 'image/png' })
    const checked = await checkUploadFile(png)
    expect(checked.ok).toBe(true)
    const r = await 管理者登記收款('261110', { paidOn: '2026-11-16', paidAmount: '8400', proof: checked.ok ? checked.file : undefined })
    expect(r.ok).toBe(true)
    const q = await 報價單('261110')
    const files = await db.query.quoteAttachments.findMany({ where: (t, { eq }) => eq(t.quoteId, q!.id), columns: { kind: true, filename: true } })
    expect(files).toEqual([{ kind: 'payment_proof', filename: '匯款明細.png' }])
  })

  it('登記收款後服務項目到期日不變', async () => {
    await 有服務項目('小森咖啡官網', { type: 'domain', identifier: 'morimori.com.tw', expiresAt: '2026-12-20', priceAmount: '1200' })
    await 小森報價('sent', { total: '1260' })
    await 報價單包含服務項目('261110', 'morimori.com.tw')
    await 管理者登記收款('261110', { paidOn: '2026-11-16', paidAmount: '1260' })
    const s = await db.query.services.findFirst({ where: (t, { eq }) => eq(t.identifier, 'morimori.com.tw') })
    expect(s?.expiresAt).toBe('2026-12-20')
  })

  it('連點兩次登記只入帳一次', async () => {
    await 小森報價('sent')
    const results = await Promise.all([
      管理者登記收款('261110', { paidOn: '2026-11-16', paidAmount: '8400' }),
      管理者登記收款('261110', { paidOn: '2026-11-16', paidAmount: '8400' }),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.find((r) => !r.ok)?.violationType).toBe('ALREADY_PAID')
  })
})
