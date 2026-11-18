'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { Button, FormError } from './ui'
import { emptyState } from '@/server/actions/helpers'
import { createRenewalQuoteAction } from '@/server/actions/quotes'

function Submit({ label, variant }: { label: string; variant: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant={variant} disabled={pending} className="whitespace-nowrap">
      {pending ? '開立中…' : label}
    </Button>
  )
}

/**
 * 「開立續約報價單」按鈕。成功時 server action 會直接跳到報價單頁；
 * 失敗（沒有可續約項目、沒設售價、混幣別）才會留在原頁顯示原因。
 */
export function RenewalQuoteButton({
  siteId,
  label = '開立續約報價單',
  variant = 'primary',
}: {
  siteId: string
  label?: string
  variant?: 'primary' | 'secondary'
}) {
  const [state, formAction] = useActionState(createRenewalQuoteAction, emptyState)
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="siteId" value={siteId} />
      <Submit label={label} variant={variant} />
      <FormError message={state.error} />
    </form>
  )
}
