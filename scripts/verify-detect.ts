import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

/**
 * WHOIS 與 SSL 偵測的實地驗證。
 *
 * 會連到真實網際網路，所以結果取決於網路狀況與各註冊局的回應。
 * 重點不是「日期是多少」，而是「解析出來的東西合不合理」：
 * 解析錯一個日期，報價單就會在錯的時間、用錯的金額寄給客戶。
 *
 * 執行：npm run verify:detect
 */

let pass = 0
let fail = 0
let skip = 0

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

function ok(label: string, condition: boolean, detail = '') {
  if (condition) {
    pass++
    console.log(`  ✓ ${label}${detail ? ` → ${detail}` : ''}`)
  } else {
    fail++
    console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ''}`)
  }
}

function warn(label: string, detail: string) {
  skip++
  console.log(`  ~ ${label}（略過）→ ${detail}`)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function main() {
  const { checkSsl, hostnameOf } = await import('../src/lib/ssl')
  const { domainOf, lookupDomain, parseWhoisDate } = await import(
    '../src/lib/whois'
  )
  const { checkUptime } = await import('../src/lib/uptime')
  const { daysUntil } = await import('../src/lib/dates')

  console.log('\n[主機名稱解析]')
  eq('完整網址', hostnameOf('https://example.com/path?a=1'), 'example.com')
  eq('無協定', hostnameOf('example.com'), 'example.com')
  eq('帶連接埠', hostnameOf('https://example.com:8443'), 'example.com')
  eq('空字串回傳 null', hostnameOf('  '), null)

  console.log('\n[可註冊網域收斂]')
  eq('去掉 www', domainOf('https://www.example.com'), 'example.com')
  eq('保持兩段', domainOf('example.com'), 'example.com')
  // com.tw 是兩段式 TLD，要多取一段才是可註冊的網域
  eq('com.tw 取三段', domainOf('www.example.com.tw'), 'example.com.tw')
  eq('子網域收斂', domainOf('tw.yahoo.com'), 'yahoo.com')
  eq('多層子網域收斂', domainOf('a.b.c.example.com.tw'), 'example.com.tw')

  console.log('\n[WHOIS 日期解析]')
  /**
   * TWNIC 的格式沒有冒號分隔，且同一份回應裡同時有 expires 與 created，
   * 抓錯行會讓系統以為網域早就逾期 —— 這組測試守住這兩點。
   */
  eq(
    'TWNIC 格式（無冒號、帶時區）',
    parseWhoisDate('Record expires on 2035-05-31 00:00:00 (UTC+8)'),
    '2035-05-31',
  )
  eq(
    '一般 ISO 格式',
    parseWhoisDate('Registry Expiry Date: 2028-09-14T04:00:00Z'),
    '2028-09-14',
  )
  eq('斜線格式', parseWhoisDate('expires: 2027/03/08'), '2027-03-08')
  eq('英文月份 15-Oct-2026', parseWhoisDate('15-Oct-2026'), '2026-10-15')
  eq('英文月份 5 Aug 2027', parseWhoisDate('paid-till: 5 Aug 2027'), '2027-08-05')
  eq('無日期回傳 null', parseWhoisDate('no date here at all'), null)
  eq('空字串回傳 null', parseWhoisDate('   '), null)

  console.log('\n[SSL 憑證偵測]')
  const ssl = await checkSsl('https://www.google.com')
  if (ssl.ok) {
    ok('取得到期日', DATE_RE.test(ssl.expiresAt), ssl.expiresAt)
    ok('到期日在未來', daysUntil(ssl.expiresAt) > 0, `剩 ${daysUntil(ssl.expiresAt)} 天`)
    ok('取得簽發者', Boolean(ssl.issuer), ssl.issuer ?? '')
  } else {
    warn('SSL 偵測', ssl.error)
  }

  const sslBad = await checkSsl('https://this-host-does-not-exist-xyz.invalid')
  eq('不存在的主機回傳錯誤', sslBad.ok, false)

  console.log('\n[WHOIS 網域偵測]')
  for (const domain of ['google.com', 'gov.tw']) {
    const result = await lookupDomain(domain)
    if (result.ok) {
      ok(`${domain} 取得到期日`, DATE_RE.test(result.expiresAt), result.expiresAt)
      ok(
        `${domain} 到期日合理（未來 10 年內）`,
        daysUntil(result.expiresAt) > 0 && daysUntil(result.expiresAt) < 3700,
        `剩 ${daysUntil(result.expiresAt)} 天`,
      )
      if (result.registrar) console.log(`      註冊商：${result.registrar}`)
    } else {
      // WHOIS 伺服器常有頻率限制，查不到不算程式錯誤
      warn(`${domain} WHOIS`, result.error)
    }
  }

  console.log('\n[存活檢查]')
  const up = await checkUptime('https://www.google.com')
  ok('可連線網站判定為 ok', up.ok, `HTTP ${up.statusCode} / ${up.responseMs}ms`)

  const downSite = await checkUptime('https://this-host-does-not-exist-xyz.invalid')
  eq('不存在的網站判定為失敗', downSite.ok, false)
  ok('失敗時有錯誤訊息', Boolean(downSite.error), downSite.error ?? '')

  const timeout = await checkUptime('https://www.google.com', 1)
  eq('逾時會被攔下', timeout.ok, false)

  console.log(
    `\n通過 ${pass} 項${fail > 0 ? `，失敗 ${fail} 項` : ''}${skip > 0 ? `，略過 ${skip} 項` : ''}\n`,
  )
  return fail
}

main()
  .then((f) => process.exit(f === 0 ? 0 : 1))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
