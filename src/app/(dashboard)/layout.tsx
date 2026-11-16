import Link from 'next/link'
import { redirect } from 'next/navigation'

import { currentUserEmail, signOut } from '@/auth'

const NAV = [
  { href: '/', label: '儀表板' },
  { href: '/services', label: '到期總表' },
  { href: '/clients', label: '客戶' },
  { href: '/projects', label: '專案' },
  { href: '/quotes', label: '報價單' },
  { href: '/settings', label: '設定' },
] as const

export default async function DashboardLayout({
  children,
}: LayoutProps<'/'>) {
  // proxy.ts 只檢查 cookie 在不在，真正的授權驗證在這裡
  const email = await currentUserEmail()
  if (!email) redirect('/login')

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <Link href="/" className="shrink-0 text-sm font-bold">
            網站續約管理
          </Link>

          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <form
            action={async () => {
              'use server'
              await signOut({ redirectTo: '/login' })
            }}
            className="flex shrink-0 items-center gap-3"
          >
            <span className="hidden text-xs text-muted sm:inline">{email}</span>
            <button
              type="submit"
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              登出
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  )
}
