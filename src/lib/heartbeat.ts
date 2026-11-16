import { env, features } from './env'

/**
 * 通知外部監控主機「這支排程剛成功跑完」。
 *
 * 外部監控主機（獨立的 PHP 腳本）記錄每支排程最後一次的心跳，
 * 超過門檻沒收到就發 LINE + Email 告警——這是「整台 VPS 停掉」時唯一的告警來源。
 *
 * 失敗一律只記 log、不拋錯：心跳送不出去不代表排程失敗，
 * 而外部監控會因為收不到心跳自己告警（設計即如此）。
 */
export async function pingHeartbeat(job: string): Promise<boolean> {
  if (!features.heartbeat) return false
  try {
    const url = new URL(env.HEARTBEAT_URL)
    url.searchParams.set('job', job)
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.HEARTBEAT_TOKEN}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) {
      console.warn(`[heartbeat] ${job} HTTP ${response.status}`)
      return false
    }
    return true
  } catch (error) {
    console.warn(`[heartbeat] ${job} 失敗：${error instanceof Error ? error.message : error}`)
    return false
  }
}
