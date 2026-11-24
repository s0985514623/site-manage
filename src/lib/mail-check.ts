import { Resolver } from 'node:dns/promises'
import { connect } from 'node:net'

import type { MailCheckItem } from '@/db/schema'
import { hostnameOf, looksLikeHost } from './ssl'

/**
 * 企業信箱檢查：只做外部探測，不需要信箱密碼。
 *
 *   收信：MX 紀錄 → 連 MX 主機 25 port 做 SMTP 對話，RCPT TO 確認信箱會被收下
 *   寄信：SPF／DKIM／DMARC 是否設定正確（決定寄出的信會不會被當垃圾信或退信）
 *
 * SMTP 探測只走到 RCPT TO 就 QUIT，不會真的寄出信件。
 * MAIL FROM 用空寄件者 <>：RFC 5321 規定一定要接受（退信就是用它），
 * 也避免用我方網域當寄件者時，因為 VPS 的 IP 不在 SPF 裡而被拒。
 *
 * DNS 與 SMTP 都經過 mailNet，測試換成假的，不碰真的網路。
 */

export type MailCheckStatus = MailCheckItem['status']

export type SmtpProbeResult =
  /** 連上並走完對話。code / message 是 RCPT TO（或更早被拒那一步）的回應 */
  | { connected: true; stage: 'banner' | 'ehlo' | 'mail' | 'rcpt'; code: number; message: string; starttls: boolean }
  | { connected: false; error: 'refused' | 'timeout' | 'other'; message: string }

type MxRecord = { exchange: string; priority: number }

const DNS_TIMEOUT_MS = 5_000
const SMTP_TIMEOUT_MS = 15_000

let shared: Resolver | null = null
function resolver() {
  shared ??= new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 })
  return shared
}

export const mailNet = {
  resolveMx: (domain: string): Promise<MxRecord[]> => resolver().resolveMx(domain),
  resolveTxt: (name: string): Promise<string[][]> => resolver().resolveTxt(name),
  smtpProbe: (host: string, rcpt: string, helo: string): Promise<SmtpProbeResult> =>
    smtpProbe(host, rcpt, helo),
}

/* ------------------------------------------------------------------ */
/* 網域與信箱地址                                                        */
/* ------------------------------------------------------------------ */

/**
 * 信箱網域的取用順序（與到期偵測相同）：
 *   1. 服務項目的「偵測目標」
 *   2. 項目名稱本身（僅當它看起來像網域）
 *   3. 網站主網址
 * 一律去掉 www.。
 */
export function mailDomainOf(
  service: { detectHost: string | null; identifier: string },
  site: { primaryUrl: string | null },
): string | null {
  const target =
    service.detectHost?.trim() ||
    (looksLikeHost(service.identifier) ? service.identifier : null) ||
    site.primaryUrl
  if (!target) return null
  const host = hostnameOf(target)
  if (!host || !host.includes('.')) return null
  return host.toLowerCase().replace(/^www\./, '')
}

/** 留空 = service@<網域> */
export function mailboxOf(service: { mailbox: string | null }, domain: string): string {
  return service.mailbox?.trim() || `service@${domain}`
}

/* ------------------------------------------------------------------ */
/* 檢查                                                                 */
/* ------------------------------------------------------------------ */

/** 沒指定 selector 時依序嘗試。涵蓋 Google Workspace、Microsoft 365、Zoho、cPanel 等常見主機 */
export const COMMON_DKIM_SELECTORS = [
  'google',
  'selector1',
  'selector2',
  'default',
  'zoho',
  'zmail',
  'k1',
  's1',
  's2',
  'mail',
  'dkim',
  'resend',
] as const

const RANK: Record<MailCheckStatus, number> = { ok: 0, warn: 1, fail: 2 }

export function worstStatus(items: Pick<MailCheckItem, 'status'>[]): MailCheckStatus {
  return items.reduce<MailCheckStatus>((w, i) => (RANK[i.status] > RANK[w] ? i.status : w), 'ok')
}

function dnsCode(error: unknown): string {
  return (error as { code?: string })?.code ?? ''
}

/** 查無紀錄（ENOTFOUND／ENODATA）回空陣列；其他錯誤（逾時、伺服器失敗）往外丟 */
async function txtRecords(name: string, retry = true): Promise<string[]> {
  try {
    const records = await mailNet.resolveTxt(name)
    // 一筆 TXT 可能被切成多段字串，要接起來才是完整內容
    return records.map((chunks) => chunks.join(''))
  } catch (error) {
    if (['ENOTFOUND', 'ENODATA'].includes(dnsCode(error))) return []
    // 家用路由器等小型 DNS 遇到連續查詢偶爾會拒絕或逾時，重試一次
    if (retry) return txtRecords(name, false)
    throw error
  }
}

const dnsFailed = (error: unknown) =>
  `DNS 查詢失敗（${dnsCode(error) || (error instanceof Error ? error.message : String(error))}），稍後再試`

async function checkMx(domain: string): Promise<{ item: MailCheckItem; hosts: string[] }> {
  const base = { key: 'mx', group: 'receive', label: 'MX 紀錄' } as const
  let records: MxRecord[]
  try {
    records = await mailNet.resolveMx(domain)
  } catch (error) {
    if (['ENOTFOUND', 'ENODATA'].includes(dnsCode(error))) {
      return { item: { ...base, status: 'fail', detail: '沒有 MX 紀錄，外面寄來的信收不到' }, hosts: [] }
    }
    return { item: { ...base, status: 'warn', detail: dnsFailed(error) }, hosts: [] }
  }

  const sorted = [...records].sort((a, b) => a.priority - b.priority)
  // RFC 7505 Null MX：「.」代表這個網域明確宣告不收信
  if (sorted.length === 0 || sorted.every((r) => r.exchange === '' || r.exchange === '.')) {
    return { item: { ...base, status: 'fail', detail: '網域宣告不收信（Null MX）' }, hosts: [] }
  }
  const hosts = sorted.map((r) => r.exchange.replace(/\.$/, ''))
  return {
    item: { ...base, status: 'ok', detail: sorted.map((r) => `${r.priority} ${r.exchange.replace(/\.$/, '')}`).join('、') },
    hosts,
  }
}

async function checkSmtp(hosts: string[], mailbox: string, helo: string): Promise<MailCheckItem> {
  const base = { key: 'smtp', group: 'receive', label: `收信測試（${mailbox}）` } as const
  if (hosts.length === 0) return { ...base, status: 'fail', detail: '沒有可連線的 MX 主機' }

  const failures: string[] = []
  let allTimeout = true
  for (const host of hosts) {
    const r = await mailNet.smtpProbe(host, mailbox, helo)
    if (!r.connected) {
      if (r.error !== 'timeout') allTimeout = false
      failures.push(`${host}：${r.message}`)
      continue
    }

    const reply = `${r.code} ${r.message}`.trim()
    const tls = r.starttls ? '' : '；伺服器不支援 STARTTLS，信件以明文傳送'
    if (r.stage === 'rcpt' && (r.code === 250 || r.code === 251)) {
      return { ...base, status: r.starttls ? 'ok' : 'warn', detail: `${host} 接受此信箱${tls}` }
    }
    if (r.code >= 400 && r.code < 500) {
      return { ...base, status: 'warn', detail: `${host} 暫時拒絕（${reply}），可能是灰名單，稍後再試` }
    }
    if (r.stage === 'rcpt') {
      return { ...base, status: 'fail', detail: `${host} 拒收此信箱，可能不存在或已停用（${reply}）` }
    }
    // 還沒到 RCPT 就被拒：多半是擋了我們這台主機的 IP，不代表信箱有問題
    return { ...base, status: 'warn', detail: `${host} 拒絕探測連線（${reply}），可能封鎖了本系統主機的 IP` }
  }

  // 全部逾時：最常見的原因是本機或 VPS 的網路擋了對外 25 port，不直接判定信箱壞掉
  if (allTimeout) {
    return {
      ...base,
      status: 'warn',
      detail: `連不上任何 MX 的 25 port（${failures.join('；')}）。若每個網域都這樣，是本系統主機的網路擋了 25 port`,
    }
  }
  return { ...base, status: 'fail', detail: `所有 MX 主機都連不上：${failures.join('；')}` }
}

async function checkSpf(domain: string): Promise<MailCheckItem> {
  const base = { key: 'spf', group: 'send', label: 'SPF' } as const
  let records: string[]
  try {
    records = (await txtRecords(domain)).filter((r) => /^v=spf1(\s|$)/i.test(r.trim()))
  } catch (error) {
    return { ...base, status: 'warn', detail: dnsFailed(error) }
  }
  if (records.length === 0) {
    return { ...base, status: 'fail', detail: '沒有 SPF 紀錄，寄出的信容易被退信或當成垃圾信' }
  }
  if (records.length > 1) {
    return { ...base, status: 'fail', detail: `有 ${records.length} 筆 SPF，收件方會判定無效，需合併成一筆` }
  }
  const spf = records[0].trim()
  const all = spf.match(/(^|\s)([+~?-]?)all(\s|$)/i)
  if (!all) return { ...base, status: 'warn', detail: `${spf}（結尾缺少 ~all 或 -all）` }
  if (all[2] === '' || all[2] === '+') {
    return { ...base, status: 'fail', detail: `${spf}（+all 允許任何人冒用這個網域寄信）` }
  }
  if (all[2] === '?') return { ...base, status: 'warn', detail: `${spf}（?all 等於沒有限制，建議改 ~all）` }
  return { ...base, status: 'ok', detail: spf }
}

async function checkDkim(domain: string, selector: string | null): Promise<MailCheckItem> {
  const base = { key: 'dkim', group: 'send', label: 'DKIM' } as const
  const custom = selector?.trim()
  const selectors = custom ? [custom] : COMMON_DKIM_SELECTORS
  try {
    for (const sel of selectors) {
      const found = (await txtRecords(`${sel}._domainkey.${domain}`)).find((r) => /(^|;)\s*p=[^;\s]+/i.test(r))
      if (found) return { ...base, status: 'ok', detail: `selector「${sel}」已設定` }
    }
  } catch (error) {
    return { ...base, status: 'warn', detail: dnsFailed(error) }
  }
  if (custom) {
    return { ...base, status: 'fail', detail: `找不到 ${custom}._domainkey.${domain} 的 DKIM 公鑰` }
  }
  return {
    ...base,
    status: 'warn',
    detail: '常見的 selector 都沒有 DKIM。若信箱主機用自訂 selector，請在服務項目填寫「DKIM selector」',
  }
}

async function checkDmarc(domain: string): Promise<MailCheckItem> {
  const base = { key: 'dmarc', group: 'send', label: 'DMARC' } as const
  let records: string[]
  try {
    records = (await txtRecords(`_dmarc.${domain}`)).filter((r) => /^v=DMARC1/i.test(r.trim()))
  } catch (error) {
    return { ...base, status: 'warn', detail: dnsFailed(error) }
  }
  if (records.length === 0) {
    return { ...base, status: 'warn', detail: '沒有 DMARC 紀錄，Gmail／Yahoo 對沒有 DMARC 的寄件網域較嚴格' }
  }
  if (records.length > 1) {
    return { ...base, status: 'fail', detail: `有 ${records.length} 筆 DMARC，收件方會全部忽略` }
  }
  const policy = records[0].match(/(^|;)\s*p=(\w+)/i)?.[2]?.toLowerCase()
  if (!policy) return { ...base, status: 'fail', detail: `${records[0]}（缺少 p= 政策）` }
  return { ...base, status: 'ok', detail: policy === 'none' ? `${records[0]}（p=none 只監看，不擋冒名信）` : records[0] }
}

export async function checkMail(input: {
  domain: string
  mailbox: string
  dkimSelector: string | null
  /** SMTP EHLO 用的主機名稱（本系統的網域） */
  helo: string
}): Promise<{ status: MailCheckStatus; results: MailCheckItem[] }> {
  // 依序查詢：DKIM 會連查十幾個 selector，並行時小型 DNS 伺服器容易拒絕
  const mx = await checkMx(input.domain)
  const spf = await checkSpf(input.domain)
  const dkim = await checkDkim(input.domain, input.dkimSelector)
  const dmarc = await checkDmarc(input.domain)
  const smtp = await checkSmtp(mx.hosts, input.mailbox, input.helo)
  const results = [mx.item, smtp, spf, dkim, dmarc]
  return { status: worstStatus(results), results }
}

/* ------------------------------------------------------------------ */
/* SMTP 探測（真的網路）                                                 */
/* ------------------------------------------------------------------ */

/**
 * 連 host:25，依序 banner → EHLO → MAIL FROM:<> → RCPT TO → QUIT。
 * 任何一步回非 2xx 就停在那一步回報。
 */
function smtpProbe(host: string, rcpt: string, helo: string): Promise<SmtpProbeResult> {
  return new Promise((resolve) => {
    let settled = false
    let buffer = ''
    let starttls = false
    let stage: 'banner' | 'ehlo' | 'mail' | 'rcpt' = 'banner'

    const socket = connect({ host, port: 25 })
    const done = (result: SmtpProbeResult) => {
      if (settled) return
      settled = true
      if (result.connected) socket.end('QUIT\r\n')
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(SMTP_TIMEOUT_MS, () =>
      done(
        stage === 'banner' && !buffer
          ? { connected: false, error: 'timeout', message: `連線逾時（${SMTP_TIMEOUT_MS / 1000} 秒）` }
          : { connected: true, stage, code: 421, message: '伺服器回應逾時', starttls },
      ),
    )
    socket.on('error', (error: NodeJS.ErrnoException) =>
      done({
        connected: false,
        error: error.code === 'ECONNREFUSED' ? 'refused' : error.code === 'ETIMEDOUT' ? 'timeout' : 'other',
        message: error.code === 'ECONNREFUSED' ? '拒絕連線' : error.message,
      }),
    )

    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buffer += chunk
      // 多行回應以「250-」接續、「250 」結束；等最後一行到齊才處理
      const lines = buffer.split('\r\n')
      const last = lines.findIndex((l) => /^\d{3}( |$)/.test(l))
      if (last === -1) return
      const reply = lines.slice(0, last + 1)
      buffer = lines.slice(last + 1).join('\r\n')

      const code = Number(reply[last].slice(0, 3))
      const message = reply.map((l) => l.slice(4)).join(' ').trim().slice(0, 300)
      if (code < 200 || code >= 400) {
        done({ connected: true, stage, code, message, starttls })
        return
      }
      switch (stage) {
        case 'banner':
          stage = 'ehlo'
          socket.write(`EHLO ${helo}\r\n`)
          break
        case 'ehlo':
          starttls = reply.some((l) => /^250[- ]STARTTLS/i.test(l))
          stage = 'mail'
          socket.write('MAIL FROM:<>\r\n')
          break
        case 'mail':
          stage = 'rcpt'
          socket.write(`RCPT TO:<${rcpt}>\r\n`)
          break
        case 'rcpt':
          done({ connected: true, stage, code, message, starttls })
          break
      }
    })
  })
}
