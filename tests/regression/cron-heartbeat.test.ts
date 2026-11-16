import { describe, expect, it } from 'vitest'

import { fakeNet } from '../fakes/network'
import { 排程執行, type CronName } from '../support/cron'
import { 系統設定為 } from '../support/given'

/** 第 5 階段：8 支排程成功後都會通知外部監控主機；密鑰錯誤不送 */
const ALL: CronName[] = [
  'expiry-scan',
  'quote-draft',
  'quote-followup',
  'payment-followup',
  'weekly-report',
  'gcal-sync',
  'detect',
  'uptime',
]

describe('所有排程都送心跳', () => {
  it.each(ALL)('%s 成功後送出心跳', async (name) => {
    await 系統設定為({ autoSend: false, lineAdmin: true })
    const r = await 排程執行(name)
    expect(r.status).toBe(200)
    expect(fakeNet.calls('heartbeat').map((p) => new URL(p.url).searchParams.get('job'))).toEqual([name])
  })

  it('密鑰錯誤時回 401 且不送心跳', async () => {
    const { GET } = await import('@/app/api/cron/uptime/route')
    const response = await GET(new Request('https://site.test/api/cron/uptime', { headers: { authorization: 'Bearer wrong' } }))
    expect(response.status).toBe(401)
    expect(fakeNet.calls('heartbeat')).toHaveLength(0)
  })
})
