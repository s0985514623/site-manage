import { connect } from 'node:tls'

import { formatDate, type DateStr } from './dates'

/**
 * 讀取網站 SSL 憑證的到期日。
 *
 * 用 Node 內建的 TLS，不需要第三方套件：建立連線、取出對方憑證、
 * 讀 validTo 就結束。憑證在 TLS 握手階段就拿得到，不必真的發 HTTP 請求。
 */

export type SslResult =
  | {
      ok: true
      expiresAt: DateStr
      issuer: string | null
      subject: string | null
    }
  | { ok: false; error: string }

/** 從網址或網域字串取出主機名稱 */
export function hostnameOf(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  try {
    const url = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`)
    return url.hostname || null
  } catch {
    return null
  }
}

export async function checkSsl(
  input: string,
  timeoutMs = 10_000,
): Promise<SslResult> {
  const host = hostnameOf(input)
  if (!host) return { ok: false, error: '無法解析主機名稱' }

  return new Promise<SslResult>((resolve) => {
    let settled = false
    const done = (result: SslResult) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }

    const socket = connect(
      {
        host,
        port: 443,
        servername: host, // SNI，否則共用 IP 的主機會回錯憑證
        // 即使憑證已過期或不受信任也要能讀到資訊 —— 那正是我們要偵測的狀況
        rejectUnauthorized: false,
      },
      () => {
        const cert = socket.getPeerCertificate()
        if (!cert || !cert.valid_to) {
          done({ ok: false, error: '對方沒有提供憑證' })
          return
        }
        const validTo = new Date(cert.valid_to)
        if (Number.isNaN(validTo.getTime())) {
          done({ ok: false, error: `無法解析憑證日期：${cert.valid_to}` })
          return
        }
        // 憑證欄位可能是字串或字串陣列（多值 RDN），統一取第一個
        const first = (v: string | string[] | undefined) =>
          Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

        done({
          ok: true,
          expiresAt: formatDate(validTo),
          issuer: first(cert.issuer?.O) ?? first(cert.issuer?.CN),
          subject: first(cert.subject?.CN),
        })
      },
    )

    socket.setTimeout(timeoutMs, () =>
      done({ ok: false, error: `連線逾時（${timeoutMs / 1000} 秒）` }),
    )
    socket.on('error', (error) => done({ ok: false, error: error.message }))
  })
}
