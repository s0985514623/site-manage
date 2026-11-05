import type { ZodError } from 'zod'

/**
 * Server Action 的統一回傳型別，搭配 useActionState 使用。
 * 只回傳第一則錯誤訊息：表單都不長，逐條列出反而讓人找不到重點。
 */
export type ActionState = {
  error?: string
  ok?: boolean
}

export const emptyState: ActionState = {}

export function formError(error: ZodError): ActionState {
  return { error: error.issues[0]?.message ?? '輸入內容有誤' }
}
