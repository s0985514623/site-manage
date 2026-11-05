'use client'

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { Button, FormError } from './ui'
import { revealCredential, type RevealState } from '@/server/actions/credentials'

/**
 * 密碼顯示按鈕。
 *
 * 明文不隨頁面一起送到瀏覽器，要按下按鈕才向伺服器索取，
 * 且會在一段時間後自動收回 —— 畫面常常開著沒人看，
 * 或被截圖、被旁人瞄到。每次索取都會寫入稽核紀錄。
 */

const AUTO_HIDE_MS = 30_000

function RevealButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? '解密中…' : '顯示密碼'}
    </Button>
  )
}

export function CredentialReveal({ id }: { id: string }) {
  const [state, formAction] = useActionState<RevealState, FormData>(
    revealCredential,
    {},
  )
  const [copied, setCopied] = useState(false)

  /**
   * 不把「正在顯示」鏡射成另一份 state —— 那得在 effect 裡同步呼叫
   * setVisible，React 會因此多跑一輪 render（react-hooks/set-state-in-effect）。
   * 改成只記住「已經收回的那一次結果」，要不要顯示直接從 action 的回傳值推導。
   *
   * 比對的是物件身分而不是密碼字串：useActionState 每次送出都回傳新物件，
   * 所以同一組密碼連按兩次「顯示密碼」仍會重新展開。
   */
  const [dismissed, setDismissed] = useState<RevealState | null>(null)
  const secret = state !== dismissed ? state.secret : undefined

  useEffect(() => {
    if (!secret) return
    const timer = setTimeout(() => setDismissed(state), AUTO_HIDE_MS)
    return () => clearTimeout(timer)
  }, [secret, state])

  if (secret) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <code className="flex-1 break-all rounded-lg border border-warning/40 bg-warning-bg px-3 py-2 font-mono text-sm text-foreground">
            {secret}
          </code>
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(secret)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              } catch {
                // 沒有剪貼簿權限時就讓使用者自行選取複製
              }
            }}
          >
            {copied ? '已複製' : '複製'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setDismissed(state)}
          >
            隱藏
          </Button>
        </div>
        <p className="text-xs text-muted">
          30 秒後自動隱藏。此次存取已記錄於稽核紀錄。
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm text-muted">••••••••••</span>
        <RevealButton />
      </div>
      <FormError message={state.error} />
    </form>
  )
}
