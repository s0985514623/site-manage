import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Next.js 16 起 Middleware 更名為 Proxy，功能不變。
 *
 * 這裡只做「樂觀檢查」——看 session cookie 在不在，不在就直接導去登入頁，
 * 省掉一次無謂的頁面渲染。真正的授權驗證一律在 Server Component /
 * Server Action 裡用 requireUser() 做（見 src/auth.ts），
 * 因為 Proxy 不該承擔完整的 session 驗證責任。
 */

const SESSION_COOKIES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
]

/** 不需要登入的路徑：各自有獨立的驗證機制 */
function isPublic(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/healthz' || // 健康檢查，只回 ok / error
    pathname.startsWith('/api/auth/') || // Auth.js 自己的流程
    pathname.startsWith('/api/cron/') || // 以 CRON_SECRET 驗證
    pathname.startsWith('/api/line/') // 以 LINE 簽章 + userId 白名單驗證
  )
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (isPublic(pathname)) return NextResponse.next()

  const hasSession = SESSION_COOKIES.some((name) =>
    request.cookies.has(name),
  )
  if (hasSession) return NextResponse.next()

  const loginUrl = new URL('/login', request.url)
  if (pathname !== '/') {
    loginUrl.searchParams.set('next', pathname + search)
  }
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: [
    /*
     * 比對所有路徑，但排除：
     * - _next/static、_next/image：建置產物
     * - favicon.ico、public 下的靜態檔
     */
    '/((?!_next/static|_next/image|favicon.ico|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|ttf|woff2?)$).*)',
  ],
}
