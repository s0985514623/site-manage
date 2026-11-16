/**
 * 在容器內呼叫 /api/cron/<端點>。由 VPS 的 systemd timer 執行：
 *
 *   docker compose -p site-manager -f .../docker-compose.yml \
 *     exec -T app node scripts/run-cron.mjs <端點>
 *
 * 為什麼在容器內跑：app 不對主機開 port，只掛在 Caddy 與 DB 的 docker 網路上。
 * CRON_SECRET 只存在容器環境變數裡，不會出現在主機的指令列（ps 看得到）。
 * Caddy 對外一律擋掉 /api/cron/*，所以排程只能從這裡觸發。
 */

import process from 'node:process'

const endpoint = process.argv[2] ?? ''
if (!/^[a-z0-9-]+$/.test(endpoint)) {
  console.error(`✗ 端點名稱不合法：${endpoint || '(空白)'}`)
  process.exit(2)
}

const secret = process.env.CRON_SECRET
if (!secret) {
  console.error('✗ 缺少 CRON_SECRET')
  process.exit(2)
}

const port = process.env.PORT || 3000

try {
  const res = await fetch(`http://127.0.0.1:${port}/api/cron/${endpoint}`, {
    headers: { Authorization: `Bearer ${secret}` },
    // 最長的排程 maxDuration 是 300 秒，多留 20 秒
    signal: AbortSignal.timeout(320_000),
  })
  const body = (await res.text()).slice(0, 500)
  console.log(`${endpoint} HTTP ${res.status} ${body}`)
  process.exitCode = res.ok ? 0 : 1
} catch (error) {
  console.error(`✗ ${endpoint} 失敗：${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
