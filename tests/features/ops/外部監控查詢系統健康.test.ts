import { afterEach, describe, expect, it, vi } from 'vitest'

/** 「資料庫無法連線」：把 @/db 的 sql 包一層，開關打開時查詢一律失敗 */
const state = vi.hoisted(() => ({ down: false }))
vi.mock('@/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db')>()
  const sql = Object.assign(
    (...args: Parameters<typeof real.sql>) =>
      state.down ? Promise.reject(new Error('connection refused')) : real.sql(...args),
    real.sql,
  )
  return { ...real, sql }
})

async function 外部監控主機查詢系統健康() {
  const { GET } = await import('@/app/healthz/route')
  const response = await GET()
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

describe('外部監控查詢系統健康', () => {
  afterEach(() => {
    state.down = false
  })

  it('未登入呼叫健康檢查可取得結果且不含細節', async () => {
    const r = await 外部監控主機查詢系統健康()
    expect(r.status).toBe(200)
    expect(Object.keys(r.body)).toEqual(['status'])
  })

  it('系統正常時回應 ok', async () => {
    const r = await 外部監控主機查詢系統健康()
    expect(r).toEqual({ status: 200, body: { status: 'ok' } })
  })

  it('資料庫斷線時回應 503', async () => {
    state.down = true
    const r = await 外部監控主機查詢系統健康()
    expect(r).toEqual({ status: 503, body: { status: 'error' } })
  })

  it('不需登入：proxy 放行 /healthz', async () => {
    const { proxy } = await import('@/proxy')
    const { NextRequest } = await import('next/server')
    const response = proxy(new NextRequest('https://site.test/healthz'))
    expect(response.headers.get('location')).toBeNull()
  })
})
