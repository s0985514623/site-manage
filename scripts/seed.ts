import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

import { assertLocalDatabase } from './local-db-guard'

/**
 * 開發用種子資料，以「九如基金會主機報價單」的真實情境為藍本。
 *
 * 到期日設為 2026/10/15（與範本一致），觸發天數 45 天的話今天就會擬單，
 * 可以直接對照產出的 PDF 與你手上的範本。
 *
 * 另外放一個「兩項到期日不同」的網站，用來檢查合併報價時
 * 每項服務期間是否各自起算。
 *
 * 執行：npm run db:seed
 */

async function main() {
  assertLocalDatabase('db:seed')

  const { db } = await import('../src/db')
  const { clients, contacts, plans, services, sites } = await import(
    '../src/db/schema'
  )
  const { eq } = await import('drizzle-orm')
  const { plusDays, today } = await import('../src/lib/dates')

  // 示範資料只 INSERT 不去重，重跑會多出一份一樣的客戶
  const existing = await db.select({ id: clients.id }).from(clients).limit(1)
  if (existing.length > 0) {
    throw new Error(
      '資料庫裡已經有客戶資料，拒絕匯入示範資料。要重來請先執行 npm run db:reset',
    )
  }

  const base = today()
  const day = (n: number) => plusDays(base, n)

  console.log(`今天（台北）：${base}`)

  const hostingPlan = await db.query.plans.findFirst({
    where: eq(plans.name, '虛擬主機 10GB（報價單既有版本）'),
  })
  if (!hostingPlan) {
    throw new Error('找不到方案範本，請先執行 npm run db:seed-company')
  }

  /* ---------------- 案例一：對照範本 ---------------- */
  const [foundation] = await db
    .insert(clients)
    .values({
      name: '財團法人台北市九如禪林基金會',
      taxId: '92006852',
      representative: '吳如英',
      address: '台北市建國北路一段90號10樓',
      phone: '03-2551994',
    })
    .returning()

  await db.insert(contacts).values({
    clientId: foundation.id,
    name: '（待補）',
    role: 'decision',
    email: 's0985514623@gmail.com', // 測試寄信先指向自己
    isPrimary: true,
    receiveQuotes: true,
  })

  const [foundationSite] = await db
    .insert(sites)
    .values({
      clientId: foundation.id,
      name: '主機',
      cmsType: 'WordPress',
      status: 'live',
    })
    .returning()

  await db.insert(services).values([
    {
      siteId: foundationSite.id,
      type: 'hosting',
      identifier: '虛擬主機續約',
      provider: '冠澄代管',
      isOurs: true,
      planId: hostingPlan.id,
      expiresAt: '2026-10-15',
      billingCycle: 'yearly',
      priceAmount: '5000.00',
      currency: 'TWD',
    },
    {
      siteId: foundationSite.id,
      type: 'domain',
      identifier: '網域名稱續約',
      isOurs: true,
      expiresAt: '2026-10-15',
      billingCycle: 'yearly',
      priceAmount: '1000.00',
      currency: 'TWD',
    },
  ])

  /* ---------------- 案例二：到期日不同，檢查期間各自起算 ---------------- */
  const [studio] = await db
    .insert(clients)
    .values({
      name: '晴天設計有限公司',
      taxId: '12345678',
      representative: '林雅婷',
      address: '台北市大安區復興南路一段 100 號 5 樓',
      phone: '02-2345-6789',
      note: '每年 12 月需提前請款，會計月底結帳。',
    })
    .returning()

  await db.insert(contacts).values([
    {
      clientId: studio.id,
      name: '林雅婷',
      role: 'decision',
      email: 's0985514623@gmail.com',
      phone: '0912-345-678',
      isPrimary: true,
      receiveQuotes: true,
    },
    {
      clientId: studio.id,
      name: '陳志明',
      role: 'finance',
      email: 's0985514623@gmail.com',
      receiveQuotes: true,
    },
  ])

  const [siteA] = await db
    .insert(sites)
    .values({
      clientId: studio.id,
      name: '官方網站',
      primaryUrl: 'https://example.com',
      cmsType: 'WordPress',
      status: 'live',
      dnsNote: 'A 記錄指向 Cloudflare（Proxy 開啟）\nMX 指向 Google Workspace',
      monitorEnabled: true,
    })
    .returning()

  await db.insert(services).values([
    {
      siteId: siteA.id,
      type: 'domain',
      identifier: 'example.com',
      provider: 'Gandi',
      providerAccount: 'studio@ourcompany.tw',
      isOurs: true,
      expiresAt: day(40),
      billingCycle: 'yearly',
      costAmount: '650.00',
      priceAmount: '1200.00',
    },
    {
      siteId: siteA.id,
      type: 'hosting',
      identifier: 'Cloudways 2GB 方案',
      provider: 'Cloudways',
      isOurs: true,
      planId: hostingPlan.id,
      expiresAt: day(70), // 比網域晚 30 天到期
      billingCycle: 'yearly',
      costAmount: '8400.00',
      priceAmount: '12000.00',
    },
    {
      siteId: siteA.id,
      type: 'maintenance',
      identifier: '年度維護合約',
      isOurs: true,
      expiresAt: day(200), // 超出合併窗口，不該被納入
      billingCycle: 'yearly',
      priceAmount: '24000.00',
    },
    {
      siteId: siteA.id,
      type: 'domain',
      identifier: 'example.com.tw',
      provider: 'TWNIC / 中華電信',
      providerAccount: '客戶自己的帳號',
      isOurs: false, // 客戶自管：照常提醒但不計費
      expiresAt: day(35),
      billingCycle: 'yearly',
    },
  ])

  console.log('\n已建立：')
  console.log(`  ${foundation.name}`)
  console.log(`    虛擬主機續約 / 網域名稱續約　到期 2026-10-15（對照你的範本）`)
  console.log(`  ${studio.name}`)
  console.log(`    example.com          到期 ${day(40)}（+40 天，代管）`)
  console.log(`    Cloudways 2GB        到期 ${day(70)}（+70 天，代管）`)
  console.log(`    年度維護合約          到期 ${day(200)}（+200 天，超出窗口）`)
  console.log(`    example.com.tw       到期 ${day(35)}（+35 天，客戶自管）`)
  console.log('\n提醒：聯絡人 Email 全部指向你自己，方便測試寄信。')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
