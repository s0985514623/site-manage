import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { requireUser } from '@/auth'
import { logActivity } from '@/lib/activity'
import { safeEqual } from '@/lib/crypto'
import { ensureCalendar, exchangeCode } from '@/lib/gcal'

export const dynamic = 'force-dynamic'

const STATE_COOKIE = 'gcal_oauth_state'

/** 把結果帶回設定頁顯示，不在這個頁面自行渲染訊息 */
function back(status: string, detail?: string): never {
  const params = new URLSearchParams({ gcal: status })
  if (detail) params.set('detail', detail.slice(0, 300))
  redirect(`/settings?${params}`)
}

export async function GET(request: Request) {
  const email = await requireUser()

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  const jar = await cookies()
  const expected = jar.get(STATE_COOKIE)?.value
  jar.delete(STATE_COOKIE)

  if (error) {
    back('denied', error === 'access_denied' ? '你取消了授權' : error)
  }
  if (!code || !state) back('error', '回呼缺少必要參數')

  // 定時比較，且 state 用完即丟
  if (!expected || !safeEqual(state, expected)) {
    back('error', '授權狀態驗證失敗，請重新操作一次')
  }

  /**
   * back() 靠丟出 NEXT_REDIRECT 來跳轉，所以成功的跳轉必須放在 try 外面；
   * 放在裡面會被 catch 接住，成功也顯示成「授權失敗 NEXT_REDIRECT」。
   */
  let failure: string | null = null
  try {
    await exchangeCode(code)
    const calendarId = await ensureCalendar()
    await logActivity(email, 'gcal.authorized', 'settings', null, {
      calendarId,
    })
  } catch (cause) {
    failure = cause instanceof Error ? cause.message : String(cause)
    await logActivity(email, 'gcal.authorize_failed', 'settings', null, {
      error: failure,
    })
  }

  if (failure !== null) back('error', failure)
  back('ok')
}
