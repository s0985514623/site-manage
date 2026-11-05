import { formatDate, type DateStr } from './dates'
import { hostnameOf } from './ssl'

/**
 * 以 WHOIS 查詢網域到期日。
 *
 * WHOIS 沒有統一格式，不同註冊局的欄位名稱與日期寫法都不一樣，
 * 所以這裡列出常見欄位名逐一嘗試。特別是 `.tw` 由 TWNIC 管理，
 * 回應是純文字而非鍵值對，需要另外處理。
 *
 * 查到的結果**不會**直接覆蓋人工維護的到期日（見 detect cron）：
 * 解析錯誤的日期會讓報價單在錯的時間、用錯的金額寄出去。
 */

export type WhoisResult =
  | { ok: true; expiresAt: DateStr; registrar: string | null; raw: string }
  | { ok: false; error: string }

/** 各註冊局常見的到期日欄位名，全部轉小寫比對 */
const EXPIRY_KEYS = [
  'expiry date',
  'registry expiry date',
  'registrar registration expiration date',
  'expiration date',
  'expiration time',
  'expires on',
  'expires',
  'paid-till',
  'valid until',
  'renewal date',
  'domain expiration date',
]

const REGISTRAR_KEYS = ['registrar', 'sponsoring registrar', 'registrar name']

/**
 * 常見的兩段式頂級網域。用於把子網域收斂成「可註冊的網域」。
 *
 * 完整判斷需要 Public Suffix List，但那是一份上萬筆的清單；
 * 這裡只列台灣接案實務上會遇到的，其餘退回「最後兩段」的通則。
 */
const TWO_PART_TLDS = new Set([
  'com.tw', 'net.tw', 'org.tw', 'idv.tw', 'gov.tw', 'edu.tw', 'game.tw',
  'ebiz.tw', 'club.tw', 'co.uk', 'org.uk', 'com.cn', 'com.hk', 'com.sg',
  'co.jp', 'com.au', 'co.nz', 'com.my',
])

/** 取出可註冊的網域。www.a.example.com.tw → example.com.tw */
export function domainOf(input: string): string | null {
  const host = hostnameOf(input)?.replace(/^www\./i, '')
  if (!host) return null

  const parts = host.split('.')
  if (parts.length <= 2) return host

  const lastTwo = parts.slice(-2).join('.')
  // com.tw 這類要多取一段才是可註冊的網域
  const keep = TWO_PART_TLDS.has(lastTwo) ? 3 : 2
  return parts.slice(-keep).join('.')
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

/**
 * 從一整行文字裡找出日期。
 *
 * 刻意接受整行而非切過的欄位值：不同註冊局的分隔符不一致
 * （TWNIC 的「Record expires on 2027-08-05 15:00:00」連冒號都沒有），
 * 直接在行內找日期樣式比猜分隔符可靠。
 */
export function parseWhoisDate(value: string): DateStr | null {
  const text = value.trim()
  if (!text) return null

  // 2026-10-15 / 2026-10-15T00:00:00Z / 2026-10-15 00:00:00 (UTC+8)
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  // 2026/10/15
  const slash = text.match(/(\d{4})\/(\d{2})\/(\d{2})/)
  if (slash) return `${slash[1]}-${slash[2]}-${slash[3]}`

  // 15-Oct-2026 / 15 Aug 2027
  const named = text.match(/(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s](\d{4})/)
  if (named) {
    const month = MONTHS[named[2].toLowerCase()]
    if (month) return `${named[3]}-${month}-${named[1].padStart(2, '0')}`
  }

  // 最後才試通用解析，且僅限短字串，避免整行文字被胡亂解讀
  if (text.length <= 40) {
    const parsed = new Date(text)
    if (!Number.isNaN(parsed.getTime())) return formatDate(parsed)
  }

  return null
}

/** 從 whoiser 回傳的巢狀結果裡撈出想要的欄位 */
function pick(data: unknown, keys: string[]): string | null {
  if (!data || typeof data !== 'object') return null

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const lower = key.toLowerCase().trim()
    if (keys.includes(lower)) {
      if (typeof value === 'string' && value.trim()) return value
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
    }
    // whoiser 會以「WHOIS 伺服器」為鍵分層，往下再找一層
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = pick(value, keys)
      if (nested) return nested
    }
  }
  return null
}

/** 把整份回應攤平成文字，供正規表達式做最後嘗試 */
function flatten(data: unknown, depth = 0): string {
  if (depth > 4) return ''
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return data.map((d) => flatten(d, depth + 1)).join('\n')
  if (data && typeof data === 'object') {
    return Object.entries(data as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${flatten(v, depth + 1)}`)
      .join('\n')
  }
  return ''
}

export async function lookupDomain(
  input: string,
  timeoutMs = 15_000,
): Promise<WhoisResult> {
  const domain = domainOf(input)
  if (!domain) return { ok: false, error: '無法解析網域名稱' }

  try {
    const { whoisDomain } = await import('whoiser')
    const data = await whoisDomain(domain, { timeout: timeoutMs, follow: 2 })
    const raw = flatten(data)

    /**
     * 依序嘗試兩種來源，兩者都把「整行」交給 parseDate 去找日期，
     * 而不是切在冒號後面。
     *
     * TWNIC 的寫法是「Record expires on 2027-08-05 15:00:00 (UTC+8)」——
     * 欄位名後面沒有冒號，若以冒號切割會抓到時間裡的冒號，
     * 最後只拿到「00:00 (UTC+8)」而解析失敗。
     */
    const candidates: string[] = []

    const fromField = pick(data, EXPIRY_KEYS)
    if (fromField) candidates.push(fromField)

    /**
     * 只比對含「到期」語意的行。刻意不比對 created / registered，
     * 抓錯行拿到建立日期的話，系統會以為這個網域早就逾期。
     */
    for (const line of raw.split('\n')) {
      if (/expir|paid-till|valid until|renewal date/i.test(line)) {
        candidates.push(line)
      }
    }

    if (candidates.length === 0) {
      return { ok: false, error: `WHOIS 回應中找不到到期日欄位（${domain}）` }
    }

    let expiresAt: DateStr | null = null
    for (const candidate of candidates) {
      expiresAt = parseWhoisDate(candidate)
      if (expiresAt) break
    }

    if (!expiresAt) {
      return {
        ok: false,
        error: `無法解析到期日格式：${candidates[0].trim().slice(0, 60)}`,
      }
    }

    return {
      ok: true,
      expiresAt,
      registrar: pick(data, REGISTRAR_KEYS),
      raw: raw.slice(0, 4000),
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
