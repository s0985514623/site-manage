import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

/**
 * 金額與日期的純邏輯驗證。
 *
 * 這兩組函式的錯誤不會讓程式崩潰，只會讓報價單金額差幾塊錢、
 * 或讓到期提醒早一天晚一天 —— 都是會讓客戶失去信任的錯誤，
 * 所以特別拉出來逐條驗。
 *
 * 執行：npm run verify:logic
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
    console.error(`  ✗ ${label}\n      預期 ${e}\n      實際 ${a}`)
  }
}

async function main() {
  const { computeTotals, lineAmountCents, toCents, formatMoney } = await import(
    '../src/lib/money'
  )
  const {
    advanceByCycle,
    daysUntil,
    noticeLevelFor,
    plusDays,
    urgencyOf,
  } = await import('../src/lib/dates')

  console.log('\n[稅額計算]')
  // 網域 1200 + 主機 12000 = 13200，未稅外加 5% → 稅 660，合計 13860
  eq(
    '未稅 13200 外加 5%',
    computeTotals([toCents('1200'), toCents('12000')], 'exclusive', 0.05),
    { subtotal: '13200.00', taxAmount: '660.00', total: '13860.00' },
  )
  eq('免稅 13200', computeTotals([toCents('13200')], 'none', 0.05), {
    subtotal: '13200.00',
    taxAmount: '0.00',
    total: '13200.00',
  })
  // 含稅 13860 反推：未稅 13200、稅 660
  eq('含稅 13860 反推', computeTotals([toCents('13860')], 'inclusive', 0.05), {
    subtotal: '13200.00',
    taxAmount: '660.00',
    total: '13860.00',
  })
  // 浮點數陷阱：0.1 + 0.2 用一般 JS 加法會得到 0.30000000000000004
  eq('浮點累加 0.1 + 0.2', computeTotals([toCents('0.1'), toCents('0.2')], 'none', 0), {
    subtotal: '0.30',
    taxAmount: '0.00',
    total: '0.30',
  })
  eq('單項金額 1200 × 3', lineAmountCents('1200', 3), 360000)
  eq('數量留空視為 1', lineAmountCents('1200', ''), 120000)

  console.log('\n[金額顯示]')
  eq('TWD 不顯示小數', formatMoney('13860.00', 'TWD'), 'NT$13,860')
  eq('USD 顯示兩位', formatMoney('99.5', 'USD'), 'USD 99.50')

  console.log('\n[計費週期推進]')
  eq('年繳 2026-10-15', advanceByCycle('2026-10-15', 'yearly'), '2027-10-15')
  eq('兩年 2026-10-15', advanceByCycle('2026-10-15', 'biennial'), '2028-10-15')
  eq('月繳 2026-01-31', advanceByCycle('2026-01-31', 'monthly'), '2026-02-28')
  eq('季繳 2026-12-01', advanceByCycle('2026-12-01', 'quarterly'), '2027-03-01')
  // 閏年：2028 年 2 月有 29 天
  eq('年繳跨閏日 2027-02-28', advanceByCycle('2027-02-28', 'yearly'), '2028-02-28')

  console.log('\n[到期天數]')
  eq('同一天為 0', daysUntil('2026-10-15', '2026-10-15'), 0)
  eq('隔天為 1', daysUntil('2026-10-16', '2026-10-15'), 1)
  eq('逾期為負', daysUntil('2026-10-10', '2026-10-15'), -5)
  eq('跨年計算', daysUntil('2027-01-01', '2026-12-31'), 1)
  eq('跨月加天', plusDays('2026-10-31', 1), '2026-11-01')

  console.log('\n[提醒門檻]')
  eq('剩 90 天觸發', noticeLevelFor(90), 90)
  eq('剩 45 天不觸發', noticeLevelFor(45), null)
  eq('剩 1 天觸發', noticeLevelFor(1), 1)
  eq('今天到期必須觸發', noticeLevelFor(0), 0)
  eq('逾期一律為 -1', noticeLevelFor(-3), -1)
  eq('剩 2 天不觸發', noticeLevelFor(2), null)

  console.log('\n[加密]')
  const { encrypt, decrypt, sha256, safeEqual } = await import(
    '../src/lib/crypto'
  )
  const secret = 'wp-admin 密碼 P@ssw0rd!中文測試'
  const box = encrypt(secret)
  eq('加解密還原', decrypt(box), secret)
  eq('密文不等於明文', box.ciphertext !== secret, true)
  // 每次加密的 IV 必須不同，否則相同明文會產生相同密文而洩漏資訊
  eq('同一明文兩次加密的密文不同', encrypt(secret).ciphertext !== box.ciphertext, true)

  let tamperDetected = false
  try {
    // 竄改一個字元，GCM 的 authTag 驗證應該要失敗
    const flipped = box.ciphertext[0] === 'A' ? 'B' : 'A'
    decrypt({ ...box, ciphertext: flipped + box.ciphertext.slice(1) })
  } catch {
    tamperDetected = true
  }
  eq('竄改密文會被偵測而非吐出錯誤明文', tamperDetected, true)
  eq('sha256 長度為 64', sha256('abc').length, 64)
  eq('safeEqual 相同', safeEqual('abc', 'abc'), true)
  eq('safeEqual 不同長度', safeEqual('abc', 'abcd'), false)

  console.log('\n[PDF 中文斷行]')
  /**
   * react-pdf 以空白切詞，中文整句會被當成單一個詞而溢出欄位；
   * 改用 hyphenationCallback 又會在斷點插入連字號（原始碼寫死，無法關閉）。
   * 所以改成自己量測字寬預先斷行 —— 這組測試守住「不溢出、不出現連字號」。
   */
  const { measure, wrapText } = await import('../src/lib/pdf/wrap')

  eq('中文量測有寬度', measure('報價單', 8) > 0, true)
  eq('空字串寬度為 0', measure('', 8), 0)
  eq(
    '較長的字串較寬',
    measure('請於到期日前完成匯款', 8) > measure('請於到期日', 8),
    true,
  )
  eq('字級加倍寬度加倍', Math.round(measure('報價單', 16)), Math.round(measure('報價單', 8) * 2))

  const long =
    '請於到期日2026/10/15前完成匯款，以避免網域或主機遭服務商釋出影響使用權利'
  const W = 190
  const wrapped = wrapText(long, W, 8)
  const lines = wrapped.split('\n')

  eq('長句會被折行', lines.length > 1, true)
  eq(
    '每一行都不超過可用寬度',
    lines.every((l) => measure(l, 8) <= W),
    true,
  )
  eq('折行後不遺漏任何字', wrapped.replace(/\n/g, ''), long)
  eq('折行結果不含連字號', wrapped.includes('-'), false)
  eq(
    '行首不會是收尾標點',
    lines.slice(1).every((l) => !'、。，！？；：）」'.includes(l[0])),
    true,
  )
  console.log(lines.map((l) => `      │${l}`).join('\n'))

  eq('短句不折行', wrapText('主機、網域續約', W, 8).includes('\n'), false)
  eq('空值回傳空字串', wrapText(null, W, 8), '')
  eq('既有換行保留', wrapText('第一行\n第二行', W, 8), '第一行\n第二行')

  // 英數字詞不可從中間切開，否則網址與帳號會被拆壞
  const withUrl = wrapText(
    '網域名稱為 verylongdomainname.example.com.tw 請確認無誤',
    120,
    8,
  )
  eq(
    '英數詞不被切開',
    withUrl.includes('verylongdomainname.example.com.tw'),
    true,
  )

  console.log('\n[急迫度分級]')
  eq('逾期', urgencyOf(-1), 'overdue')
  eq('14 天內', urgencyOf(14), 'critical')
  eq('15 天歸 30 天內', urgencyOf(15), 'warning')
  eq('31 天歸 90 天內', urgencyOf(31), 'upcoming')
  eq('91 天為安全', urgencyOf(91), 'safe')

  console.log(
    `\n通過 ${pass} 項${fail > 0 ? `，失敗 ${fail} 項` : ''}\n`,
  )
  return fail
}

main()
  .then((f) => process.exit(f === 0 ? 0 : 1))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
