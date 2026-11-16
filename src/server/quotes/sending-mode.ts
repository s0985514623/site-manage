import { logActivity } from '@/lib/activity'
import { features } from '@/lib/env'
import { updateSettings } from '@/lib/settings'
import { fail, type ActionState } from '@/server/actions/helpers'

/**
 * 報價寄送模式。
 *   manual = 手動寄：草稿只推純通知，到後台按「寄出」由系統寄信
 *   auto   = LINE 確認後自動寄：草稿推確認訊息，按確認就寄
 *
 * 切成手動時，已推出去的 LINE 確認按鈕會被擋下（webhook 檢查），報價單維持原狀。
 */
export type SendingMode = 'manual' | 'auto'

export async function setQuoteSendingMode(mode: string, actor: string): Promise<ActionState> {
  if (mode !== 'manual' && mode !== 'auto') {
    return fail('INVALID_ARGUMENT', '寄送模式只能是「手動寄」或「LINE 確認後自動寄」')
  }
  if (mode === 'auto' && !features.lineApproval) {
    return fail(
      'LINE_ADMIN_NOT_CONFIGURED',
      '尚未設定 LINE 管理者帳號（LINE_ADMIN_USER_ID），無法使用 LINE 確認後自動寄',
    )
  }
  await updateSettings({ autoSendEnabled: mode === 'auto' })
  await logActivity(actor, 'settings.sending_mode', 'settings', null, { mode })
  return { ok: true }
}

export async function setQuoteFollowupDays(days: string, actor: string): Promise<ActionState> {
  const n = Number(days)
  if (!Number.isInteger(n) || n < 1 || n > 90) {
    return fail('INVALID_ARGUMENT', '追蹤天數需為 1–90 的整數')
  }
  await updateSettings({ quoteFollowupDays: n })
  await logActivity(actor, 'settings.followup_days', 'settings', null, { days: n })
  return { ok: true }
}
