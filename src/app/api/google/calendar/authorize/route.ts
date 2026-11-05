import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { requireUser } from '@/auth'
import { randomToken } from '@/lib/crypto'
import { authorizeUrl } from '@/lib/gcal'

export const dynamic = 'force-dynamic'

const STATE_COOKIE = 'gcal_oauth_state'

/**
 * 開始 Google Calendar 的漸進式授權。
 *
 * 登入本身只要求 openid/email/profile（非敏感範圍），Calendar 是敏感範圍，
 * 綁進登入會讓應用程式必須通過 Google 驗證才能發布，所以分開要。
 *
 * state 參數存進 HttpOnly cookie 並在回呼時比對，防止 CSRF ——
 * 沒有這道檢查的話，攻擊者可以誘導你把「他的」Google 帳號授權進你的系統。
 */
export async function GET() {
  await requireUser()

  const state = randomToken(24)
  const jar = await cookies()
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600, // 10 分鐘內要完成授權
    path: '/',
  })

  redirect(authorizeUrl(state))
}
