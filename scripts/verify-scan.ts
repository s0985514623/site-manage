import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

import { assertLocalDatabase } from './local-db-guard'

/**
 * 到期掃描的門檻與去重驗證。
 *
 * 這支腳本會實際改動資料庫裡的到期日再改回來，所以只能在開發環境跑。
 *
 * 驗證三件事：
 * 1. 剛好落在門檻（90/60/30/14/7/1/0）的項目會被撈出來
 * 2. 沒落在門檻的不會被撈（避免每天洗版）
 * 3. 已通知過的同一天不會重複通知；但逾期項目每天都要再提醒
 *
 * 執行：npm run verify:scan
 */

let pass = 0
let fail = 0

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    // 一律寫 stdout，否則 stderr 與 stdout 不同步會讓輸出順序錯亂
    console.log(`  ✗ ${label}\n      預期 ${e}\n      實際 ${a}`)
  }
}

async function main() {
  assertLocalDatabase('verify:scan')

  const { db } = await import('../src/db')
  const { clients, notifications, services, sites } = await import(
    '../src/db/schema'
  )
  const { eq: whereEq } = await import('drizzle-orm')
  const { collectNotices, recordNotifications, buildEmailSubject } =
    await import('../src/server/expiry-scan')
  const { plusDays, today } = await import('../src/lib/dates')

  const now = today()

  // 建立一組獨立的測試資料，不干擾既有種子資料
  const [client] = await db
    .insert(clients)
    .values({ name: '[掃描測試] 客戶' })
    .returning()
  const [site] = await db
    .insert(sites)
    .values({ clientId: client.id, name: '[掃描測試] 網站' })
    .returning()

  const cleanup = async () => {
    await db.delete(sites).where(whereEq(sites.clientId, client.id))
    await db.delete(clients).where(whereEq(clients.id, client.id))
  }

  try {
    // 門檻上：90、30、0（今天到期）、-3（逾期）
    // 門檻外：45、20
    const rows = await db
      .insert(services)
      .values(
        [90, 45, 30, 20, 0, -3].map((d) => ({
          siteId: site.id,
          type: 'domain' as const,
          identifier: `test-${d}.example`,
          expiresAt: plusDays(now, d),
          priceAmount: '1000.00',
        })),
      )
      .returning()

    const idOf = (d: number) =>
      rows.find((r) => r.expiresAt === plusDays(now, d))!.id

    console.log('\n[門檻觸發]')
    const first = await collectNotices('email')
    const hit = new Set(
      first.notices
        .filter((n) => n.service.siteId === site.id)
        .map((n) => n.days),
    )

    eq('剩 90 天：觸發', hit.has(90), true)
    eq('剩 45 天：不觸發', hit.has(45), false)
    eq('剩 30 天：觸發', hit.has(30), true)
    eq('剩 20 天：不觸發', hit.has(20), false)
    eq('今天到期：觸發', hit.has(0), true)
    eq('已逾期 3 天：觸發', hit.has(-3), true)

    const overdue = first.notices.find((n) => n.days === -3)
    eq('逾期的 level 記為 -1', overdue?.level, -1)
    eq(
      '今天到期的 level 記為 0',
      first.notices.find((n) => n.days === 0)?.level,
      0,
    )

    console.log('\n[信件主旨]')
    const subject = buildEmailSubject(
      first.notices.filter((n) => n.service.siteId === site.id),
    )
    console.log(`  主旨：${subject}`)
    eq('主旨含逾期數量', subject.includes('已逾期'), true)

    console.log('\n[同日去重]')
    const mine = first.notices.filter((n) => n.service.siteId === site.id)
    await recordNotifications(mine, 'email', now, true)

    const second = await collectNotices('email')
    const stillThere = second.notices.filter(
      (n) => n.service.siteId === site.id,
    )
    eq('已通知過的項目不再出現', stillThere.length, 0)
    eq('略過計數正確', second.skippedAlreadySent >= mine.length, true)

    console.log('\n[跨日後會重新提醒]')
    /**
     * 去重鍵是 (service, level, channel, sentOn)，所以「昨天通知過」
     * 不該壓抑今天的通知 —— 逾期項目必須每天都再提醒一次。
     *
     * 直接把今天的紀錄改成昨天，等同於模擬時間前進一天。
     */
    await db
      .delete(notifications)
      .where(whereEq(notifications.serviceId, idOf(-3)))
    await db.insert(notifications).values({
      serviceId: idOf(-3),
      level: -1,
      channel: 'email',
      sentOn: plusDays(now, -1), // 昨天已通知
      ok: true,
    })

    const third = await collectNotices('email')
    const overdueAgain = third.notices.find(
      (n) => n.service.siteId === site.id && n.level === -1,
    )
    eq('昨天通知過的逾期項目，今天會再次撈出', Boolean(overdueAgain), true)

    // 反向確認：今天的紀錄才會壓抑今天的通知
    await db.insert(notifications).values({
      serviceId: idOf(-3),
      level: -1,
      channel: 'email',
      sentOn: now,
      ok: true,
    })
    const fourth = await collectNotices('email')
    eq(
      '今天通知過的逾期項目，今天不會重複',
      fourth.notices.some(
        (n) => n.service.siteId === site.id && n.level === -1,
      ),
      false,
    )

    console.log('\n[LINE 與 Email 各自獨立去重]')
    const lineScan = await collectNotices('line')
    const lineMine = lineScan.notices.filter(
      (n) => n.service.siteId === site.id,
    )
    eq(
      'Email 已通知過不影響 LINE 通道',
      lineMine.length > 0,
      true,
    )

    await db
      .delete(notifications)
      .where(whereEq(notifications.serviceId, idOf(90)))
  } finally {
    await cleanup()
    console.log('\n測試資料已清除')
  }

  console.log(`\n通過 ${pass} 項${fail > 0 ? `，失敗 ${fail} 項` : ''}\n`)
  return fail
}

main()
  .then((f) => process.exit(f === 0 ? 0 : 1))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
