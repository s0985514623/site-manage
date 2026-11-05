import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

/**
 * 合併報價的分組與金額驗證。
 *
 * 對照規劃書的驗證清單：
 *   網域 +40 天、主機 +70 天、維護約 +200 天、客戶自管網域 +35 天
 *   觸發 45 天 / 窗口 60 天
 * 預期：產生一張含「網域 + 主機」的報價單，
 *      且兩項的服務期間各自從自己的到期日起算。
 *
 * 執行：npm run verify:quotes
 */

let pass = 0
let fail = 0

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
    console.log(`  ✓ ${label} → ${a}`)
  } else {
    fail++
    console.log(`  ✗ ${label}\n      預期 ${e}\n      實際 ${a}`)
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('拒絕在 production 環境執行')
  }

  const { db } = await import('../src/db')
  const { clients, quoteItems, quotes, services, sites } = await import(
    '../src/db/schema'
  )
  const { asc, eq: whereEq } = await import('drizzle-orm')
  const {
    buildItems,
    collectQuoteGroups,
    computeValidUntil,
    createQuoteForGroup,
    releaseServices,
  } = await import('../src/lib/quote-builder')
  const { getSettings } = await import('../src/lib/settings')
  const { yymmdd } = await import('../src/lib/quote-no')
  const { advanceByCycle, plusDays, today } = await import('../src/lib/dates')

  const now = today()
  const settings = await getSettings()
  console.log(
    `\n設定：觸發 ${settings.quoteTriggerDays} 天 / 窗口 ${settings.quoteWindowDays} 天 / 有效 ${settings.quoteValidDays} 天`,
  )

  const [client] = await db
    .insert(clients)
    .values({ name: '[報價測試] 客戶' })
    .returning()

  const cleanup = async () => {
    const mySites = await db.query.sites.findMany({
      where: whereEq(sites.clientId, client.id),
    })
    for (const s of mySites) {
      await db.delete(quotes).where(whereEq(quotes.siteId, s.id))
    }
    await db.delete(sites).where(whereEq(sites.clientId, client.id))
    await db.delete(clients).where(whereEq(clients.id, client.id))
  }

  try {
    const [siteA] = await db
      .insert(sites)
      .values({ clientId: client.id, name: '[報價測試] 官方網站' })
      .returning()

    await db.insert(services).values([
      {
        siteId: siteA.id,
        type: 'domain',
        identifier: 'q-test.com',
        isOurs: true,
        expiresAt: plusDays(now, 40),
        billingCycle: 'yearly',
        priceAmount: '1200.00',
      },
      {
        siteId: siteA.id,
        type: 'hosting',
        identifier: 'q-test 主機',
        isOurs: true,
        expiresAt: plusDays(now, 70),
        billingCycle: 'yearly',
        priceAmount: '12000.00',
      },
      {
        siteId: siteA.id,
        type: 'maintenance',
        identifier: 'q-test 維護約',
        isOurs: true,
        expiresAt: plusDays(now, 200),
        billingCycle: 'yearly',
        priceAmount: '24000.00',
      },
      {
        siteId: siteA.id,
        type: 'domain',
        identifier: 'q-test.com.tw',
        isOurs: false, // 客戶自管
        expiresAt: plusDays(now, 35),
        billingCycle: 'yearly',
        priceAmount: '900.00',
      },
    ])

    console.log('\n[分組]')
    const scan = await collectQuoteGroups(settings)
    const group = scan.groups.find((g) => g.siteId === siteA.id)

    eq('此網站有觸發', Boolean(group), true)
    if (!group) throw new Error('分組失敗，後續無法驗證')

    eq('錨點是最早到期的網域', group.anchor.identifier, 'q-test.com')
    eq('錨點日 = 40 天後', group.anchorDate, plusDays(now, 40))
    eq('納入項目數為 2', group.items.length, 2)
    eq(
      '納入的是網域與主機',
      group.items.map((s) => s.identifier).sort(),
      ['q-test 主機', 'q-test.com'],
    )
    eq(
      '維護約（200 天）未被納入',
      group.items.some((s) => s.identifier === 'q-test 維護約'),
      false,
    )
    eq(
      '客戶自管網域未被納入',
      group.items.some((s) => s.identifier === 'q-test.com.tw'),
      false,
    )

    console.log('\n[明細期間：各自起算]')
    const items = buildItems(group.items)
    const domainItem = items.find((i) => i.description.includes('q-test.com'))!
    const hostItem = items.find((i) => i.description.includes('主機'))!

    // 沿用現有報價單慣例：舊期間到到期日當天為止，新期間自隔天接續
    eq(
      '網域期間起日 = 網域到期日的隔天',
      domainItem.periodStart,
      plusDays(now, 41),
    )
    eq(
      '網域期間迄日 = 到期日 + 1 年',
      domainItem.periodEnd,
      advanceByCycle(plusDays(now, 40), 'yearly'),
    )
    eq(
      '主機期間起日 = 主機到期日的隔天',
      hostItem.periodStart,
      plusDays(now, 71),
    )
    eq(
      '★ 主機期間起日 ≠ 報價單錨點日（否則客戶被吃掉 30 天）',
      hostItem.periodStart !== group.anchorDate,
      true,
    )
    eq(
      '兩項期間不重疊到同一天',
      domainItem.periodStart !== hostItem.periodStart,
      true,
    )
    eq('單位欄位為「年」', domainItem.unit, '年')
    console.log(`      網域：${domainItem.periodStart} ~ ${domainItem.periodEnd}`)
    console.log(`      主機：${hostItem.periodStart} ~ ${hostItem.periodEnd}`)

    console.log('\n[有效期限]')
    eq(
      '有效期限不超過錨點到期日',
      computeValidUntil(plusDays(now, 5), 14, now),
      plusDays(now, 5),
    )
    eq(
      '錨點還很遠時用設定天數',
      computeValidUntil(plusDays(now, 40), 14, now),
      plusDays(now, 14),
    )
    // 錨點已逾期時，不可算出位於過去的有效期限
    eq(
      '★ 錨點已逾期時有效期限仍在未來',
      computeValidUntil(plusDays(now, -5), 14, now),
      plusDays(now, 14),
    )
    eq(
      '錨點正好是今天時有效期限在未來',
      computeValidUntil(now, 14, now),
      plusDays(now, 14),
    )

    console.log('\n[建立報價單]')
    const created = await createQuoteForGroup(group, settings)
    // 資料庫裡可能已有今日的報價單，所以第一張不一定是無後綴的
    eq('編號格式為 YYMMDD 或 YYMMDD-N', /^\d{6}(-\d+)?$/.test(created.quoteNo), true)
    eq('編號以今日日期開頭', created.quoteNo.startsWith(yymmdd(now)), true)
    eq('明細 2 筆', created.itemCount, 2)
    // 1200 + 12000 = 13200，未稅外加 5% → 13860
    eq('合計含 5% 稅', created.total, '13860.00')
    console.log(`      ${created.quoteNo}  ${created.clientName} · ${created.siteName}  NT$${created.total}`)

    const saved = await db.query.quotes.findFirst({
      where: whereEq(quotes.id, created.id),
      with: { items: { orderBy: [asc(quoteItems.sortOrder)] } },
    })
    eq('小計為未稅金額', saved?.subtotal, '13200.00')
    eq('稅額為 660', saved?.taxAmount, '660.00')
    eq('狀態為草稿', saved?.status, 'draft')
    eq('資料庫中明細 2 筆', saved?.items.length, 2)

    console.log('\n[同月連號]')
    /**
     * 回歸測試：曾經因為 substring(x from $1) 的型別歧義被解析成
     * 正規表達式版本，導致每次都算出 001，同月第二張單就撞唯一索引。
     */
    const [siteE] = await db
      .insert(sites)
      .values({ clientId: client.id, name: '[報價測試] 第二站' })
      .returning()
    await db.insert(services).values({
      siteId: siteE.id,
      type: 'hosting',
      identifier: '第二站主機',
      isOurs: true,
      expiresAt: plusDays(now, 15),
      billingCycle: 'yearly',
      priceAmount: '3000.00',
    })
    const scanE = await collectQuoteGroups(settings)
    const groupE = scanE.groups.find((g) => g.siteId === siteE.id)!
    const secondQuote = await createQuoteForGroup(groupE, settings)
    eq('第二張單編號不與第一張相同', secondQuote.quoteNo !== created.quoteNo, true)
    console.log(`      第一張 ${created.quoteNo}　第二張 ${secondQuote.quoteNo}`)

    /** '260930' → 1、'260930-3' → 3 */
    const seqOf = (no: string) => {
      const dash = no.indexOf('-')
      return dash === -1 ? 1 : Number(no.slice(dash + 1))
    }
    eq('同日下一張的序號 +1', seqOf(secondQuote.quoteNo) - seqOf(created.quoteNo), 1)
    eq('兩張單同屬今日的日期前綴', secondQuote.quoteNo.startsWith(yymmdd(now)), true)

    console.log('\n[防重複開單]')
    const afterServices = await db.query.services.findMany({
      where: whereEq(services.siteId, siteA.id),
    })
    const drafted = afterServices.filter((s) => s.renewalState === 'drafted')
    eq('被納入的項目標記為 drafted', drafted.length, 2)
    eq(
      '被納入的項目都指向這張報價單',
      drafted.every((s) => s.currentQuoteId === created.id),
      true,
    )

    const secondScan = await collectQuoteGroups(settings)
    eq(
      '再跑一次不會重複開單',
      secondScan.groups.some((g) => g.siteId === siteA.id),
      false,
    )

    console.log('\n[取消後釋放]')
    await releaseServices(created.id)
    const released = await db.query.services.findMany({
      where: whereEq(services.siteId, siteA.id),
    })
    eq(
      '釋放後回到 upcoming',
      released.filter((s) => s.renewalState === 'upcoming').length,
      4,
    )
    const thirdScan = await collectQuoteGroups(settings)
    eq(
      '釋放後可重新擬草稿',
      thirdScan.groups.some((g) => g.siteId === siteA.id),
      true,
    )

    console.log('\n[未設售價與混幣別]')
    const [siteB] = await db
      .insert(sites)
      .values({ clientId: client.id, name: '[報價測試] 無售價站' })
      .returning()
    await db.insert(services).values({
      siteId: siteB.id,
      type: 'hosting',
      identifier: '未定價主機',
      isOurs: true,
      expiresAt: plusDays(now, 10),
      billingCycle: 'yearly',
      priceAmount: null,
    })

    const [siteC] = await db
      .insert(sites)
      .values({ clientId: client.id, name: '[報價測試] 混幣站' })
      .returning()
    await db.insert(services).values([
      {
        siteId: siteC.id,
        type: 'domain',
        identifier: 'mixed.com',
        isOurs: true,
        expiresAt: plusDays(now, 10),
        billingCycle: 'yearly',
        priceAmount: '1200.00',
        currency: 'TWD',
      },
      {
        siteId: siteC.id,
        type: 'hosting',
        identifier: 'mixed 主機',
        isOurs: true,
        expiresAt: plusDays(now, 20),
        billingCycle: 'yearly',
        priceAmount: '30.00',
        currency: 'USD',
      },
    ])

    // 全部項目都是 0 元：不該開出一張 NT$0 的報價單寄給客戶
    const [siteD] = await db
      .insert(sites)
      .values({ clientId: client.id, name: '[報價測試] 全零元站' })
      .returning()
    await db.insert(services).values([
      {
        siteId: siteD.id,
        type: 'ssl',
        identifier: "Let's Encrypt 憑證",
        isOurs: true,
        expiresAt: plusDays(now, 10),
        billingCycle: 'quarterly',
        priceAmount: '0.00',
      },
    ])

    const edgeScan = await collectQuoteGroups(settings)
    eq(
      '未設售價的網站被略過',
      edgeScan.skipped.find((s) => s.siteId === siteB.id)?.reason,
      'no_price',
    )
    eq(
      '★ 總額為 0 的網站被略過（不寄 NT$0 報價單）',
      edgeScan.skipped.find((s) => s.siteId === siteD.id)?.reason,
      'zero_total',
    )
    eq(
      '混幣別的網站被略過（不會把 TWD 與 USD 相加）',
      edgeScan.skipped.find((s) => s.siteId === siteC.id)?.reason,
      'mixed_currency',
    )
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
