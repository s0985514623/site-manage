import type { taxModeEnum } from '@/db/schema'

export type TaxMode = (typeof taxModeEnum.enumValues)[number]

/**
 * 金額一律先轉成整數「分」再運算，最後才轉回字串。
 *
 * 理由：0.1 + 0.2 !== 0.3。報價單上的稅額與合計只要差一塊錢，
 * 客戶對帳時就會來問，而且會顯得不專業。
 */

/** '1200.00' → 120000（分） */
export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

/** 120000（分） → '1200.00' */
export function fromCents(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2)
}

/**
 * 報價單表格內的金額：5,000
 *
 * 不加 NT$ 前綴，與現有報價單一致 —— 表格裡每列都掛一次幣別符號
 * 反而干擾閱讀。非台幣時仍標出幣別代碼以免誤會。
 */
export function formatAmount(
  value: string | number | null | undefined,
  currency = 'TWD',
): string {
  const amount = toCents(value) / 100
  if (currency === 'TWD') return Math.round(amount).toLocaleString('zh-TW')
  return `${currency} ${amount.toLocaleString('zh-TW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** 介面顯示用：NT$1,200（TWD 不顯示小數，其他幣別顯示兩位） */
export function formatMoney(
  value: string | number | null | undefined,
  currency = 'TWD',
): string {
  const cents = toCents(value)
  const amount = cents / 100
  if (currency === 'TWD') {
    return `NT$${Math.round(amount).toLocaleString('zh-TW')}`
  }
  return `${currency} ${amount.toLocaleString('zh-TW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export type Totals = {
  subtotal: string
  taxAmount: string
  total: string
}

/**
 * 依稅別計算小計、稅額、合計。
 *
 * - exclusive（未稅）：小計是未稅金額，稅額外加。台灣報價單最常見。
 * - inclusive（含稅）：輸入金額已含稅，需反推稅額。
 *   稅額 = 含稅金額 - round(含稅金額 / (1 + 稅率))
 * - none（免稅）：稅額為 0。
 */
export function computeTotals(
  lineAmountsCents: number[],
  taxMode: TaxMode,
  taxRate: string | number,
): Totals {
  const rate = typeof taxRate === 'number' ? taxRate : Number(taxRate)
  const sum = lineAmountsCents.reduce((a, b) => a + b, 0)

  if (taxMode === 'none') {
    return {
      subtotal: fromCents(sum),
      taxAmount: '0.00',
      total: fromCents(sum),
    }
  }

  if (taxMode === 'inclusive') {
    const net = Math.round(sum / (1 + rate))
    return {
      subtotal: fromCents(net),
      taxAmount: fromCents(sum - net),
      total: fromCents(sum),
    }
  }

  // exclusive
  const tax = Math.round(sum * rate)
  return {
    subtotal: fromCents(sum),
    taxAmount: fromCents(tax),
    total: fromCents(sum + tax),
  }
}

/** 單項金額 = 單價 × 數量 */
export function lineAmountCents(
  unitPrice: string | number | null | undefined,
  quantity: string | number | null | undefined,
): number {
  const qty = quantity === null || quantity === undefined || quantity === ''
    ? 1
    : Number(quantity)
  return Math.round(toCents(unitPrice) * (Number.isFinite(qty) ? qty : 1))
}

export const TAX_MODE_LABEL: Record<TaxMode, string> = {
  exclusive: '未稅（外加 5% 營業稅）',
  inclusive: '含稅',
  none: '免稅',
}
