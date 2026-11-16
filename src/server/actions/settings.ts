'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireUser } from '@/auth'
import { setQuoteFollowupDays, setQuoteSendingMode } from '@/server/quotes/sending-mode'
import { logActivity } from '@/lib/activity'
import { updateSettings } from '@/lib/settings'
import { formError, type ActionState } from './helpers'

const schema = z.object({
  companyName: z.string().trim(),
  companyTaxId: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{8}$/.test(v), '統一編號需為 8 位數字'),
  companyRepresentative: z.string().trim(),
  companyAddress: z.string().trim(),
  companyPhone: z.string().trim(),
  companyEmail: z.string().trim(),
  companyLineId: z.string().trim(),
  preparedBy: z.string().trim(),
  bankName: z.string().trim(),
  bankCode: z.string().trim(),
  bankAccount: z.string().trim(),
  bankAccountName: z.string().trim(),
  quotePaymentNote: z.string().trim(),
  quoteTriggerDays: z.coerce
    .number()
    .int()
    .min(1, '觸發天數至少 1 天')
    .max(365, '觸發天數最多 365 天'),
  quoteWindowDays: z.coerce
    .number()
    .int()
    .min(0, '合併窗口不可為負')
    .max(365, '合併窗口最多 365 天'),
  quoteValidDays: z.coerce
    .number()
    .int()
    .min(1, '報價有效天數至少 1 天')
    .max(180, '報價有效天數最多 180 天'),
  defaultTaxMode: z.enum(['exclusive', 'inclusive', 'none']),
  defaultTaxRate: z.coerce.number().min(0).max(1),
  quoteTerms: z.string().trim(),
})

function read(formData: FormData, key: string): string {
  const v = formData.get(key)
  return typeof v === 'string' ? v : ''
}

export async function saveSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()

  const parsed = schema.safeParse({
    companyName: read(formData, 'companyName'),
    companyTaxId: read(formData, 'companyTaxId'),
    companyRepresentative: read(formData, 'companyRepresentative'),
    companyAddress: read(formData, 'companyAddress'),
    companyPhone: read(formData, 'companyPhone'),
    companyEmail: read(formData, 'companyEmail'),
    companyLineId: read(formData, 'companyLineId'),
    preparedBy: read(formData, 'preparedBy'),
    bankName: read(formData, 'bankName'),
    bankCode: read(formData, 'bankCode'),
    bankAccount: read(formData, 'bankAccount'),
    bankAccountName: read(formData, 'bankAccountName'),
    quotePaymentNote: read(formData, 'quotePaymentNote'),
    quoteTriggerDays: read(formData, 'quoteTriggerDays'),
    quoteWindowDays: read(formData, 'quoteWindowDays'),
    quoteValidDays: read(formData, 'quoteValidDays'),
    defaultTaxMode: read(formData, 'defaultTaxMode') || 'exclusive',
    defaultTaxRate: read(formData, 'defaultTaxRate') || '0.05',
    quoteTerms: read(formData, 'quoteTerms'),
  })
  if (!parsed.success) return formError(parsed.error)

  const d = parsed.data

  /**
   * 報價有效天數若超過觸發天數，就會出現「報價單還在有效期內、
   * 項目卻已經過期」的荒謬狀況。在這裡擋下來。
   */
  if (d.quoteValidDays > d.quoteTriggerDays) {
    return {
      error: `報價有效天數（${d.quoteValidDays}）不可大於觸發天數（${d.quoteTriggerDays}），否則客戶可能在項目已經到期後才回覆。`,
    }
  }

  await updateSettings({
    companyName: d.companyName || null,
    companyTaxId: d.companyTaxId || null,
    companyRepresentative: d.companyRepresentative || null,
    companyAddress: d.companyAddress || null,
    companyPhone: d.companyPhone || null,
    companyEmail: d.companyEmail || null,
    companyLineId: d.companyLineId || null,
    preparedBy: d.preparedBy || null,
    bankName: d.bankName || null,
    bankCode: d.bankCode || null,
    bankAccount: d.bankAccount || null,
    bankAccountName: d.bankAccountName || null,
    quotePaymentNote: d.quotePaymentNote || null,
    quoteTriggerDays: d.quoteTriggerDays,
    quoteWindowDays: d.quoteWindowDays,
    quoteValidDays: d.quoteValidDays,
    defaultTaxMode: d.defaultTaxMode,
    defaultTaxRate: d.defaultTaxRate.toFixed(4),
    quoteTerms: d.quoteTerms || null,
  })

  await logActivity(email, 'settings.updated', 'settings', null, {
    quoteTriggerDays: d.quoteTriggerDays,
    quoteWindowDays: d.quoteWindowDays,
  })

  revalidatePath('/settings')
  revalidatePath('/')
  return { ok: true }
}

/** 寄送模式與未回覆追蹤天數（設定頁「寄送與追蹤」） */
export async function saveSendingSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireUser()
  const mode = await setQuoteSendingMode(read(formData, 'sendingMode'), email)
  if (!mode.ok) return mode
  const days = await setQuoteFollowupDays(read(formData, 'quoteFollowupDays'), email)
  if (!days.ok) return days
  revalidatePath('/settings')
  return { ok: true }
}
