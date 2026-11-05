import { redirect } from 'next/navigation'

import { auth, signIn } from '@/auth'
import { features } from '@/lib/env'

export const metadata = { title: '登入' }

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: '這個 Google 帳號不在允許清單中，無法登入。',
  Configuration: 'Google 登入尚未設定完成，請檢查 .env.local。',
  Verification: '登入連結已失效，請重新登入。',
}

export default async function LoginPage({
  searchParams,
}: PageProps<'/login'>) {
  const session = await auth()
  if (session?.user?.email) redirect('/')

  const params = await searchParams
  const errorCode = typeof params.error === 'string' ? params.error : null
  const nextPath = typeof params.next === 'string' ? params.next : '/'

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
          <h1 className="text-xl font-bold">網站續約管理</h1>
          <p className="mt-2 text-sm text-muted">
            客戶網站的網域、主機與維護合約到期追蹤
          </p>

          {errorCode && (
            <p className="mt-6 rounded-lg border border-overdue/30 bg-overdue-bg px-3 py-2 text-sm text-overdue">
              {ERROR_MESSAGES[errorCode] ?? `登入失敗（${errorCode}）`}
            </p>
          )}

          {features.googleLogin ? (
            <form
              action={async () => {
                'use server'
                await signIn('google', { redirectTo: nextPath })
              }}
              className="mt-8"
            >
              <button
                type="submit"
                className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
              >
                使用 Google 帳號登入
              </button>
            </form>
          ) : (
            <div className="mt-8 rounded-lg border border-border bg-surface-muted p-4 text-sm">
              <p className="font-medium">尚未設定 Google 登入</p>
              <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-muted">
                <li>到 Google Cloud Console 建立 OAuth 用戶端 ID（網頁應用程式）</li>
                <li>
                  授權重新導向 URI 填{' '}
                  <code className="rounded bg-surface px-1 py-0.5 text-xs">
                    http://localhost:3000/api/auth/callback/google
                  </code>
                </li>
                <li>
                  把用戶端 ID 與密鑰填進{' '}
                  <code className="rounded bg-surface px-1 py-0.5 text-xs">
                    .env.local
                  </code>{' '}
                  的 AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET
                </li>
                <li>重新啟動 npm run dev</li>
              </ol>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-muted">
          僅限 ALLOWED_EMAILS 名單內的帳號登入
        </p>
      </div>
    </main>
  )
}
