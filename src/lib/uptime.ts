/**
 * 網站存活檢查。
 *
 * 先發 HEAD（省流量），被拒絕再改 GET —— 不少 WAF 與 CDN 會擋 HEAD。
 * 只要拿得到回應就算活著：4xx/5xx 代表伺服器有在跑，屬於應用層問題，
 * 與「主機掛了、網域解析不到」是不同等級的事，分開判斷。
 */

export type UptimeResult = {
  ok: boolean
  statusCode: number | null
  responseMs: number
  error: string | null
}

const TIMEOUT_MS = 10_000
const UA = 'site-manage-monitor/1.0 (+renewal tracking)'

export async function checkUptime(
  url: string,
  timeoutMs = TIMEOUT_MS,
): Promise<UptimeResult> {
  const started = Date.now()

  const attempt = async (method: 'HEAD' | 'GET') => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, {
        method,
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'user-agent': UA },
        cache: 'no-store',
      })
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    let response = await attempt('HEAD')

    // 405 Method Not Allowed / 403 常見於擋 HEAD 的主機，改用 GET 再試
    if (response.status === 405 || response.status === 403) {
      response = await attempt('GET')
    }

    return {
      ok: response.status < 500,
      statusCode: response.status,
      responseMs: Date.now() - started,
      error:
        response.status >= 500 ? `伺服器回應 ${response.status}` : null,
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'AbortError'
          ? `連線逾時（${timeoutMs / 1000} 秒）`
          : error.message
        : String(error)

    return {
      ok: false,
      statusCode: null,
      responseMs: Date.now() - started,
      error: message,
    }
  }
}
