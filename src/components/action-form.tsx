'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import type { ReactNode } from 'react'

import { Button, FormError } from './ui'
import { emptyState, type ActionState } from '@/server/actions/helpers'

type Action = (
  state: ActionState,
  formData: FormData,
) => Promise<ActionState>

function SubmitButton({
  children,
  variant = 'primary',
}: {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'danger'
}) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? '處理中…' : children}
    </Button>
  )
}

/**
 * 包住 Server Action 的表單，統一處理送出狀態與錯誤顯示。
 *
 * 成功後預設不清空欄位（編輯表單需要保留內容），
 * 需要連續新增多筆的場景才傳 resetOnSuccess。
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  submitVariant = 'primary',
  resetOnSuccess = false,
  onSuccess,
  footer,
  className = '',
}: {
  action: Action
  children: ReactNode
  submitLabel: string
  submitVariant?: 'primary' | 'secondary' | 'danger'
  resetOnSuccess?: boolean
  onSuccess?: () => void
  footer?: ReactNode
  className?: string
}) {
  const [state, formAction] = useActionState(action, emptyState)
  const ref = useRef<HTMLFormElement>(null)

  /**
   * 「已儲存」提示不鏡射成另一份 state —— 那得在 effect 裡同步 setSaved，
   * React 會因此多跑一輪 render（react-hooks/set-state-in-effect）。
   * 改成記住「提示已經淡出的那一次結果」，要不要顯示從 action 回傳值推導。
   *
   * 比對物件身分：useActionState 每次送出都回傳新物件，所以連續儲存兩次
   * 也會各顯示一次提示。
   */
  const [acked, setAcked] = useState<ActionState | null>(null)
  const saved = Boolean(state.ok) && state !== acked

  // 清空欄位與 onSuccess 回呼是對外部的副作用，和提示的生命週期無關，分開處理
  useEffect(() => {
    if (!state.ok) return
    if (resetOnSuccess) ref.current?.reset()
    onSuccess?.()
  }, [state, resetOnSuccess, onSuccess])

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setAcked(state), 2500)
    return () => clearTimeout(timer)
  }, [saved, state])

  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      <div className="mt-4 space-y-3">
        <FormError message={state.error} />
        <div className="flex items-center gap-3">
          <SubmitButton variant={submitVariant}>{submitLabel}</SubmitButton>
          {saved && <span className="text-sm text-safe">已儲存</span>}
          {footer}
        </div>
      </div>
    </form>
  )
}

/**
 * 需要二次確認的破壞性操作（刪除）。
 * 不用 window.confirm —— 瀏覽器原生對話框會阻斷事件迴圈，
 * 而且在某些環境下會讓整個頁面失去回應。
 */
export function ConfirmForm({
  action,
  children,
  label,
  confirmLabel,
  message,
}: {
  action: Action
  children: ReactNode
  label: string
  confirmLabel: string
  message: string
}) {
  const [state, formAction] = useActionState(action, emptyState)
  const [armed, setArmed] = useState(false)

  if (!armed) {
    return (
      <div className="space-y-3">
        <FormError message={state.error} />
        <Button type="button" variant="danger" onClick={() => setArmed(true)}>
          {label}
        </Button>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      {children}
      <p className="text-sm text-overdue">{message}</p>
      <FormError message={state.error} />
      <div className="flex items-center gap-3">
        <SubmitButton variant="danger">{confirmLabel}</SubmitButton>
        <Button type="button" variant="secondary" onClick={() => setArmed(false)}>
          取消
        </Button>
      </div>
    </form>
  )
}

/** 點開才展開的表單，用於「新增聯絡人」這類次要操作 */
export function Disclosure({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>
    )
  }
  return (
    <div className="rounded-lg border border-border bg-surface-muted p-4">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-muted hover:text-foreground"
        >
          收合
        </button>
      </div>
      {children}
    </div>
  )
}
