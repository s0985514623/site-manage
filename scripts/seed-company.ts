import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

/**
 * 依現有的「九如基金會主機報價單」範本，建立乙方公司資料、匯款帳戶、
 * 主機方案範本與續約專用條款。
 *
 * 只補空白欄位，不覆蓋你已經在設定頁改過的內容，所以重複執行是安全的。
 *
 * 執行：npm run db:seed-company
 */

/**
 * 續約專用條款。
 *
 * 範本原本那 7 條是「網站製作」的合約條款（工期、驗收、逾期罰款），
 * 對主機／網域續約並不適用 —— 續約沒有工期也沒有驗收程序。
 * 這裡改寫成續約情境真正會用到的內容：期間怎麼算、逾期會怎樣、
 * 自動續約的責任歸屬。請依實際需要調整。
 */
const RENEWAL_TERMS = `1. 本報價單所列服務期間均自各項目原到期日之翌日起算，續約不影響原有效期間。
2. 請於報價有效期限內完成確認與匯款。逾期將重新報價，且供應商價格可能已調整。
3. 網域逾期未續約將進入寬限期，其後進入贖回期；贖回費用遠高於一般續約費用，且期間網站與電子郵件將無法使用。
4. 主機逾期未續約將停止服務，資料保留期限依供應商規定，逾期可能無法復原。
5. 本報價單金額僅含所列項目。如需增加空間、流量或其他加值服務，另行報價。
6. 匯款完成後請告知匯款帳號後五碼以利對帳。發票將於確認收款後開立。
7. 乙方僅負責主機與網域之代管續約及技術支援，甲方網站內容之合法性與著作權責任由甲方自負。`

const PAYMENT_NOTE =
  '請於到期日{date}前完成匯款，以避免網域或主機遭服務商釋出影響使用權利'

/** 依「伺服器維運費用」工作表整理，費用為月費，年繳金額 = 月費 × 12 */
const SERVER_PLANS = [
  {
    name: '基本方案（形象官網）',
    monthly: 600,
    storage: '10GB',
    visitors: '每月 5,000 以下',
    extra: [] as string[],
  },
  { name: '流量方案 3 萬', monthly: 1500, storage: '20GB', visitors: '每月 30,000', extra: ['cdn'] },
  { name: '流量方案 5 萬', monthly: 2700, storage: '20GB', visitors: '每月 50,000', extra: ['cdn'] },
  { name: '流量方案 15 萬', monthly: 5400, storage: '30GB', visitors: '每月 150,000', extra: ['cdn'] },
  { name: '流量方案 40 萬', monthly: 9300, storage: '50GB', visitors: '每月 400,000', extra: ['cdn'] },
  { name: '流量方案 100 萬', monthly: 21000, storage: '100GB', visitors: '每月 1,000,000', extra: ['cdn'] },
  { name: '流量方案 160 萬', monthly: 32700, storage: '160GB', visitors: '每月 1,600,000', extra: ['cdn'] },
  { name: '流量方案 200 萬', monthly: 40500, storage: '200GB', visitors: '每月 2,000,000', extra: ['cdn'] },
  { name: '流量方案 240 萬', monthly: 48300, storage: '200GB', visitors: '每月 2,400,000', extra: ['cdn'] },
  { name: '流量方案 300 萬', monthly: 60000, storage: '250GB', visitors: '每月 3,000,000', extra: ['cdn'] },
]

const BASE_SPEC = [
  'NVMe 超高速硬碟',
  'SSL 憑證',
  '定期備份',
  '伺服器軟體定期更新',
]
const CDN_SPEC = [
  '全球 CDN 發佈網路',
  '高階防火牆 WAF',
  '如伺服器損毀可自動移轉',
  '定期掃描伺服器健康狀態',
]

function specFor(plan: (typeof SERVER_PLANS)[number]): string {
  const lines = [
    `網站空間：${plan.storage}`,
    `適用流量：${plan.visitors}`,
    ...BASE_SPEC,
    ...(plan.extra.includes('cdn') ? CDN_SPEC : []),
  ]
  return lines.map((l, i) => `${i + 1}.${l}`).join('\n')
}

async function main() {
  const { db } = await import('../src/db')
  const { plans } = await import('../src/db/schema')
  const { getSettings, updateSettings } = await import('../src/lib/settings')

  /* ---------------- 乙方公司資料 ---------------- */
  const current = await getSettings()
  const patch: Record<string, unknown> = {}
  const fill = (key: string, value: string) => {
    if (!(current as Record<string, unknown>)[key]) patch[key] = value
  }

  fill('companyName', '冠澄數位行銷有限公司')
  fill('companyTaxId', '90068297')
  fill('companyRepresentative', '林宥靜')
  fill('companyAddress', '臺中市大里區瑞城里塗城路304巷28弄16號之16號1樓')
  fill('companyPhone', '0955-366-716')
  fill('companyEmail', 's0985514623@gmail.com')
  fill('companyLineId', '851026')
  fill('preparedBy', '鄭智仁')
  fill('bankName', '彰化銀行 大里分行')
  fill('bankCode', '009')
  fill('bankAccount', '6075-01-01350-6-00')
  fill('bankAccountName', '冠澄數位行銷有限公司')
  fill('quoteTerms', RENEWAL_TERMS)
  fill('quotePaymentNote', PAYMENT_NOTE)

  if (Object.keys(patch).length > 0) {
    await updateSettings(patch)
    console.log(`已填入公司設定 ${Object.keys(patch).length} 個欄位：`)
    console.log('  ' + Object.keys(patch).join('、'))
  } else {
    console.log('公司設定已存在，未變更')
  }

  /* ---------------- 方案範本 ---------------- */
  const existing = await db.select({ name: plans.name }).from(plans)
  const known = new Set(existing.map((p) => p.name))

  const rows = SERVER_PLANS.filter((p) => !known.has(p.name)).map((p, i) => ({
    name: p.name,
    type: 'hosting' as const,
    specNote: specFor(p),
    // 方案表列的是月費，這裡存年繳金額（月費 × 12）作為預設售價
    priceAmount: (p.monthly * 12).toFixed(2),
    billingCycle: 'yearly' as const,
    note: `月費 NT$${p.monthly.toLocaleString('zh-TW')}`,
    sortOrder: i,
  }))

  // 九如那張實際寄出的報價單用的是自訂規格，與方案表措辭不同，一併建為範本
  if (!known.has('虛擬主機 10GB（報價單既有版本）')) {
    rows.push({
      name: '虛擬主機 10GB（報價單既有版本）',
      type: 'hosting' as const,
      specNote:
        '1.網站空間：10GB(1024MB)\n' +
        '2.網站流量：無限制\n' +
        '3.每日備份，備份資料留存14天\n' +
        '4.基本防毒防駭\n' +
        '5.免費SSL憑證',
      priceAmount: '5000.00',
      billingCycle: 'yearly' as const,
      note: '沿用九如基金會報價單的措辭',
      sortOrder: -1,
    })
  }

  if (rows.length > 0) {
    await db.insert(plans).values(rows)
    console.log(`\n已建立 ${rows.length} 個方案範本：`)
    for (const r of rows) console.log(`  ${r.name}`)
  } else {
    console.log('\n方案範本已存在，未變更')
  }

  console.log('\n請到設定頁確認條款與公司資料是否需要調整。')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
