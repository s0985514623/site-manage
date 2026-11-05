import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'

import { allowedEmails, env, features } from '@/lib/env'

/**
 * 登入採 Google OAuth + Email 白名單。
 *
 * 系統會跑在公開網址上（LINE webhook 需要公開 HTTPS），所以一定要有登入。
 * 用 Google 登入的好處是不必自己管密碼雜湊與重設流程，而且同一次授權
 * 就能一併取得 Google Calendar 的權限。
 *
 * Session 用 JWT（不接 database adapter）：使用者只有你一個，
 * 沒必要為了單一使用者維護 sessions / accounts / users 三張表。
 */

/**
 * 登入只要求非敏感範圍（openid / email / profile）。
 *
 * Google Calendar 屬於「敏感範圍」，一旦把它綁進登入流程會有兩個後果：
 *   1. OAuth 應用程式必須通過 Google 驗證才能發布到正式狀態，
 *      而驗證需要隱私權政策、首頁網址並等待審核。
 *   2. 若維持「測試中」狀態規避驗證，refresh token 只有 7 天壽命，
 *      行事曆同步每週都會斷掉。
 *
 * 所以改採漸進式授權：登入歸登入，行事曆權限等到你真的要開啟
 * 同步功能時，再從設定頁單獨要一次（Phase 6）。
 */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar'

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: features.googleLogin
    ? [
        Google({
          clientId: env.AUTH_GOOGLE_ID,
          clientSecret: env.AUTH_GOOGLE_SECRET,
          authorization: {
            params: {
              scope: 'openid email profile',
            },
          },
        }),
      ]
    : [],
  callbacks: {
    /** 白名單之外一律拒絕，即使對方有合法的 Google 帳號 */
    signIn({ profile }) {
      const email = profile?.email?.toLowerCase()
      if (!email) return false
      return allowedEmails.includes(email)
    },
    jwt({ token, profile }) {
      if (profile?.email) token.email = profile.email
      return token
    },
    session({ session, token }) {
      if (token.email) session.user.email = token.email
      return session
    },
  },
})

/** 目前登入者的 email，未登入回傳 null */
export async function currentUserEmail(): Promise<string | null> {
  const session = await auth()
  const email = session?.user?.email?.toLowerCase() ?? null
  if (!email || !allowedEmails.includes(email)) return null
  return email
}

/**
 * Server Action / Route Handler 用的守衛。
 * proxy.ts 只做樂觀的 cookie 檢查，實際授權一律在這裡驗。
 */
export async function requireUser(): Promise<string> {
  const email = await currentUserEmail()
  if (!email) throw new Error('UNAUTHORIZED')
  return email
}
