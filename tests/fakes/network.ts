import { fakeGoogleCalendar } from './google-calendar'

/**
 * 假的外部服務：攔截全域 fetch，依網址分給 LINE / Resend / Google / 心跳。
 *
 * 不 mock 個別模組，讓測試走真正的 src/lib/line.ts、mailer.ts、gcal.ts 程式碼，
 * 只把最外層的 HTTP 換掉。每個服務都記錄收到的請求，也可以設定讓它失敗。
 * 其他網址一律拋錯，避免測試不小心打到真的網路。
 */

export type Recorded = { url: string; method: string; body: unknown }

type ServiceName = 'line' | 'resend' | 'google' | 'heartbeat' | 'hook'

const SERVICES: Array<{ name: ServiceName; match: (u: URL) => boolean }> = [
  { name: 'line', match: (u) => u.hostname === 'api.line.me' },
  { name: 'resend', match: (u) => u.hostname === 'api.resend.com' },
  { name: 'google', match: (u) => u.hostname.endsWith('googleapis.com') },
  { name: 'heartbeat', match: (u) => u.hostname === 'heartbeat.test' },
  // 排程任務「呼叫網址」的假目標
  { name: 'hook', match: (u) => u.hostname === 'hook.test' },
]

const calls: Record<ServiceName, Recorded[]> = { line: [], resend: [], google: [], heartbeat: [], hook: [] }
const failing = new Set<ServiceName>()
let googleResponder: ((req: Recorded) => unknown) | null = null

export const fakeNet = {
  reset() {
    for (const k of Object.keys(calls) as ServiceName[]) calls[k] = []
    failing.clear()
    googleResponder = null
    fakeGoogleCalendar.reset()
  },
  /** 讓某個服務回 500 */
  fail(name: ServiceName) {
    failing.add(name)
  },
  /** 自訂 Google API 的回應內容（預設回 { id: 'evt-<n>' }） */
  respondGoogle(fn: (req: Recorded) => unknown) {
    googleResponder = fn
  },
  calls(name: ServiceName): Recorded[] {
    return calls[name]
  },
  /** LINE 推播 / 回覆的所有文字訊息 */
  lineTexts(): string[] {
    return calls.line.flatMap((c) =>
      ((c.body as { messages?: Array<{ type: string; text?: string }> })?.messages ?? [])
        .filter((m) => m.type === 'text')
        .map((m) => m.text ?? ''),
    )
  },
  /** LINE 回覆 / 推播最後一則訊息的快速回覆按鈕文字 */
  lineQuickReplyLabels(): string[] {
    const last = calls.line.at(-1)?.body as
      | { messages?: Array<{ quickReply?: { items: Array<{ action: { label: string } }> } }> }
      | undefined
    const msg = last?.messages?.at(-1)
    return msg?.quickReply?.items.map((i) => i.action.label) ?? []
  },
  /** 寄出的信件 */
  mails(): Array<{ to: string[]; subject: string; html: string }> {
    return calls.resend.map((c) => c.body as { to: string[]; subject: string; html: string })
  },
}

async function readBody(init?: RequestInit): Promise<unknown> {
  const raw = init?.body
  if (raw == null) return null
  const text = typeof raw === 'string' ? raw : await new Response(raw as BodyInit).text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const service = SERVICES.find((s) => s.match(url))
  if (!service) {
    throw new Error(`測試中不允許連到外部網路：${url.href}`)
  }
  const rec: Recorded = { url: url.href, method: init?.method ?? 'GET', body: await readBody(init) }
  calls[service.name].push(rec)

  if (failing.has(service.name)) {
    return new Response(JSON.stringify({ message: `${service.name} 測試用失敗` }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (service.name === 'google') {
    if (googleResponder) {
      return new Response(JSON.stringify(googleResponder(rec)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return fakeGoogleCalendar.handle(url, rec.method, rec.body)
  }

  let payload: unknown = {}
  if (service.name === 'resend') payload = { id: `mail-${calls.resend.length}` }
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
