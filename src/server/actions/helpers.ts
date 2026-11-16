import type { ZodError } from 'zod'

/**
 * Server Action 的統一回傳型別，搭配 useActionState 使用。
 * 只回傳第一則錯誤訊息：表單都不長，逐條列出反而讓人找不到重點。
 */
export type ActionState = {
  error?: string
  ok?: boolean
  /** 失敗種類（api.yml 的 ViolationType），給測試與畫面判斷用 */
  violationType?: ViolationType
}

/** 與 specs/api/api.yml 的 ViolationType 一致 */
export const VIOLATION_TYPES = [
  'INVALID_ARGUMENT',
  'INVALID_DATE_RANGE',
  'NOT_FOUND',
  'CLIENT_INACTIVE',
  'SITE_CLIENT_MISMATCH',
  'INVALID_QUOTE_STATUS',
  'QUOTE_ALREADY_SENT',
  'NO_RECIPIENT',
  'MAIL_NOT_CONFIGURED',
  'MAIL_SEND_FAILED',
  'LINE_ADMIN_NOT_CONFIGURED',
  'ALREADY_PAID',
  'PROJECT_HAS_QUOTES',
  'HANDOVER_NOT_ALLOWED',
] as const
export type ViolationType = (typeof VIOLATION_TYPES)[number]

export const emptyState: ActionState = {}

export function formError(error: ZodError): ActionState {
  return {
    error: error.issues[0]?.message ?? '輸入內容有誤',
    violationType: 'INVALID_ARGUMENT',
  }
}

export function fail(violationType: ViolationType, error: string): ActionState {
  return { error, violationType }
}

export const success: ActionState = { ok: true }
