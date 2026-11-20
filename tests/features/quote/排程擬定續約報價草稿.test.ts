import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/db'
import { cancelQuote } from '@/server/send-quote'

import { fakeNet } from '../../fakes/network'
import { 排程執行 } from '../../support/cron'
import {
  LINE本月推播額度已用完,
  心跳端點無法連線,
  有報價收件人,
  有客戶,
  有服務項目,
  有網站,
  系統設定為,
} from '../../support/given'

async function 網站的報價單(siteName: string) {
  const site = await db.query.sites.findFirst({ where: (s, { eq }) => eq(s.name, siteName) })
  return db.query.quotes.findMany({ where: (q, { eq }) => eq(q.siteId, site!.id) })
}

describe('排程擬定續約報價草稿', () => {
  beforeEach(async () => {
    await 有客戶('小森咖啡')
    await 有網站('小森咖啡官網', '小森咖啡')
    await 有服務項目('小森咖啡官網', {
      type: 'domain',
      identifier: 'morimori.com.tw',
      expiresAt: '2026-12-20',
      priceAmount: '1200',
    })
    await 有報價收件人('小森咖啡')
  })

  it('自動寄模式產生草稿後推 LINE 確認訊息', async () => {
    await 系統設定為({ autoSend: true, lineAdmin: true })

    await 排程執行('quote-draft')

    const quotes = await 網站的報價單('小森咖啡官網')
    expect(quotes).toHaveLength(1)
    expect(quotes[0].status).toBe('pending_approval')
    // Flex Message 的按鈕文字在 contents 裡，比對整個請求內容
    const pushed = JSON.stringify(fakeNet.calls('line').map((c) => c.body))
    expect(pushed).toContain('報價確認')
    expect(pushed).toContain('確認寄出')
  })

  it('手動寄模式產生草稿後只推純通知', async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true })

    await 排程執行('quote-draft')

    const quotes = await 網站的報價單('小森咖啡官網')
    expect(quotes).toHaveLength(1)
    expect(quotes[0].status).toBe('draft')
    const texts = fakeNet.lineTexts()
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('報價草稿')
    expect(texts[0]).toContain('請至後台寄出')
    // 純通知不帶確認按鈕
    expect(JSON.stringify(fakeNet.calls('line'))).not.toContain('確認寄出')
  })

  it('推播額度用完時純通知改寄 Email', async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true })
    await LINE本月推播額度已用完()

    await 排程執行('quote-draft')

    expect(fakeNet.calls('line')).toHaveLength(0)
    const mails = fakeNet.mails()
    expect(mails).toHaveLength(1)
    expect(mails[0].to).toEqual(['owner@example.com'])
    expect(mails[0].subject).toContain('報價草稿')
  })

  it('排程成功後送出心跳', async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true })

    await 排程執行('quote-draft')

    const pings = fakeNet.calls('heartbeat')
    expect(pings).toHaveLength(1)
    expect(new URL(pings[0].url).searchParams.get('job')).toBe('quote-draft')
  })

  it('心跳端點無法連線時排程仍視為成功', async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true })
    心跳端點無法連線()

    const result = await 排程執行('quote-draft')

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    const quotes = await 網站的報價單('小森咖啡官網')
    expect(quotes).toHaveLength(1)
    expect(quotes[0].status).toBe('draft')
  })

  it('同一期間已取消的報價單不會被排程重開', async () => {
    await 系統設定為({ autoSend: false, lineAdmin: true })
    await 排程執行('quote-draft')
    const [first] = await 網站的報價單('小森咖啡官網')
    await cancelQuote(first.id, 'owner@example.com')

    const result = await 排程執行('quote-draft')

    const quotes = await 網站的報價單('小森咖啡官網')
    expect(quotes).toHaveLength(1)
    expect(quotes[0].status).toBe('cancelled')
    expect(result.body.skipped).toContainEqual(
      expect.objectContaining({ reason: 'cancelled', detail: 'morimori.com.tw' }),
    )
  })

  it('乾跑不寫入、不推播、不送心跳', async () => {
    await 系統設定為({ autoSend: true, lineAdmin: true })

    const result = await 排程執行('quote-draft', { dryRun: true })

    expect(result.body.dryRun).toBe(true)
    expect(await 網站的報價單('小森咖啡官網')).toHaveLength(0)
    expect(fakeNet.calls('line')).toHaveLength(0)
    expect(fakeNet.calls('heartbeat')).toHaveLength(0)
  })
})
