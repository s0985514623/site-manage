import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'

import { describeDays, urgencyOf, type Urgency } from '@/lib/dates'

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function PageHeader({
  title,
  description,
  action,
  back,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  back?: { href: string; label: string }
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link
          href={back.href}
          className="mb-2 inline-block text-sm text-muted hover:text-foreground"
        >
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && (
            <div className="mt-1 text-sm text-muted">{description}</div>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  )
}

export function Card({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title?: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-xl border border-border bg-surface ${className}`}
    >
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-base font-bold">{title}</h2>}
            {description && (
              <div className="mt-0.5 text-sm text-muted">{description}</div>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="font-medium">{title}</p>
      {description && (
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Form primitives                                                     */
/* ------------------------------------------------------------------ */

const fieldClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-accent disabled:opacity-50'

export function Field({
  label,
  hint,
  required,
  children,
  className = '',
}: {
  label: string
  hint?: ReactNode
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-overdue">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function Input(props: ComponentProps<'input'>) {
  return <input {...props} className={`${fieldClass} ${props.className ?? ''}`} />
}

export function Textarea(props: ComponentProps<'textarea'>) {
  return (
    <textarea
      rows={3}
      {...props}
      className={`${fieldClass} ${props.className ?? ''}`}
    />
  )
}

export function Select(props: ComponentProps<'select'>) {
  return (
    <select {...props} className={`${fieldClass} ${props.className ?? ''}`} />
  )
}

export function Checkbox({
  label,
  hint,
  ...props
}: ComponentProps<'input'> & { label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        {...props}
        className="mt-0.5 size-4 shrink-0 rounded border-border accent-accent"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  )
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'danger'
}) {
  const styles = {
    primary:
      'bg-accent text-accent-foreground hover:opacity-90 disabled:opacity-50',
    secondary:
      'border border-border text-foreground hover:bg-surface-muted disabled:opacity-50',
    danger:
      'border border-overdue/40 text-overdue hover:bg-overdue-bg disabled:opacity-50',
  }[variant]
  return (
    <button
      {...props}
      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${styles} ${className}`}
    />
  )
}

export function LinkButton({
  href,
  children,
  variant = 'primary',
}: {
  href: string
  children: ReactNode
  variant?: 'primary' | 'secondary'
}) {
  const styles =
    variant === 'primary'
      ? 'bg-accent text-accent-foreground hover:opacity-90'
      : 'border border-border text-foreground hover:bg-surface-muted'
  return (
    <Link
      href={href}
      className={`inline-block rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${styles}`}
    >
      {children}
    </Link>
  )
}

/** 表單錯誤訊息。Server Action 驗證失敗時回傳字串由此顯示 */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <p className="rounded-lg border border-overdue/30 bg-overdue-bg px-3 py-2 text-sm text-overdue">
      {message}
    </p>
  )
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

const URGENCY_STYLE: Record<Urgency, string> = {
  overdue: 'bg-overdue-bg text-overdue border-overdue/30',
  critical: 'bg-critical-bg text-critical border-critical/30',
  warning: 'bg-warning-bg text-warning border-warning/30',
  upcoming: 'bg-upcoming-bg text-upcoming border-upcoming/30',
  safe: 'bg-safe-bg text-safe border-safe/30',
}

/** 到期倒數標籤。逾期一律紅底，因為網域贖回費極高，不能和一般提醒同級 */
export function DaysBadge({ days }: { days: number }) {
  const urgency = urgencyOf(days)
  return (
    <span
      className={`tabular inline-block whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium ${URGENCY_STYLE[urgency]}`}
    >
      {describeDays(days)}
    </span>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'safe' | 'warning' | 'overdue'
}) {
  const styles = {
    neutral: 'bg-surface-muted text-muted border-border',
    accent: 'bg-upcoming-bg text-upcoming border-upcoming/30',
    safe: 'bg-safe-bg text-safe border-safe/30',
    warning: 'bg-warning-bg text-warning border-warning/30',
    overdue: 'bg-overdue-bg text-overdue border-overdue/30',
  }[tone]
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium ${styles}`}
    >
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  )
}

type Align = 'left' | 'right' | 'center'

// Tailwind 靜態掃描原始碼，動態組出的 `text-${align}` 不會產生樣式
const ALIGN: Record<Align, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
}

export function Th({
  children,
  align = 'left',
}: {
  children?: ReactNode
  align?: Align
}) {
  return (
    <th
      className={`border-b border-border px-4 py-2.5 text-xs font-medium text-muted ${ALIGN[align]}`}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  align = 'left',
  className = '',
}: {
  children?: ReactNode
  align?: Align
  className?: string
}) {
  return (
    <td
      className={`border-b border-border px-4 py-3 ${ALIGN[align]} ${className}`}
    >
      {children}
    </td>
  )
}
