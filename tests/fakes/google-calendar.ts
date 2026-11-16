/**
 * 假的 Google Calendar：記住建立過的日曆與事件，讓測試可以斷言
 * 「『專案管理』日曆應有以下事件」。只實作 src/lib/gcal.ts 用到的端點。
 */

type FakeEvent = { id: string; summary: string; date: string; body: Record<string, unknown> }
type FakeCalendar = { id: string; summary: string; events: Map<string, FakeEvent> }

let calendars = new Map<string, FakeCalendar>()
let seq = 0

function json(status: number, payload?: unknown): Response {
  if (status === 204) return new Response(null, { status })
  return new Response(JSON.stringify(payload ?? {}), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function toEvent(id: string, body: Record<string, unknown>): FakeEvent {
  const start = body.start as { date?: string } | undefined
  return { id, summary: String(body.summary ?? ''), date: start?.date ?? '', body }
}

export const fakeGoogleCalendar = {
  reset() {
    calendars = new Map()
    seq = 0
  },
  /** 依日曆名稱（「專案管理」/「網站到期管理」）列出事件 */
  events(calendarName: string): Array<{ title: string; date: string; id: string }> {
    const cal = [...calendars.values()].find((c) => c.summary === calendarName)
    if (!cal) return []
    return [...cal.events.values()].map((e) => ({ title: e.summary, date: e.date, id: e.id }))
  },

  handle(url: URL, method: string, body: unknown): Response {
    // 換存取權杖
    if (url.hostname === 'oauth2.googleapis.com') {
      return json(200, { access_token: 'fake-access-token', expires_in: 3600 })
    }

    const path = url.pathname.replace(/^\/calendar\/v3/, '')
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent)
    // /calendars
    if (parts.length === 1 && parts[0] === 'calendars' && method === 'POST') {
      const id = `cal-${++seq}`
      calendars.set(id, { id, summary: String((body as { summary?: string }).summary), events: new Map() })
      return json(200, { id })
    }
    if (parts[0] !== 'calendars' || !parts[1]) return json(404, { error: 'not found' })
    const cal = calendars.get(parts[1])
    if (!cal) return json(404, { error: 'calendar not found' })

    // /calendars/:id
    if (parts.length === 2) return json(200, { id: cal.id })

    // /calendars/:id/events
    if (parts.length === 3 && parts[2] === 'events' && method === 'POST') {
      const id = `evt-${++seq}`
      cal.events.set(id, toEvent(id, body as Record<string, unknown>))
      return json(200, { id })
    }

    // /calendars/:id/events/:eventId
    if (parts.length === 4 && parts[2] === 'events') {
      const existing = cal.events.get(parts[3])
      if (!existing) return json(404, { error: 'event not found' })
      if (method === 'DELETE') {
        cal.events.delete(parts[3])
        return json(204)
      }
      if (method === 'PATCH') {
        const merged = { ...existing.body, ...(body as Record<string, unknown>) }
        cal.events.set(existing.id, toEvent(existing.id, merged))
        return json(200, { id: existing.id })
      }
    }
    return json(400, { error: `fake 未支援：${method} ${path}` })
  },
}
