/**
 * 建立 LINE 聊天室下方的常駐選單（Rich Menu），一次性腳本，可重跑。
 *
 *   npm run line:richmenu
 *
 * 會做的事：刪掉同名的舊選單 → 建立新選單（四格）→ 上傳圖片 → 設為所有使用者的預設選單。
 * 需要 LINE_CHANNEL_ACCESS_TOKEN（從環境變數或 .env.local 讀）。
 * 圖片是 scripts/assets/richmenu.png，改字請改 scripts/make-richmenu-image.py 再重產。
 * 四格的 postback 必須與 src/app/api/line/webhook/route.ts 的 MENU_BUTTONS 一致。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

const NAME = 'site-manager 主選單'
const W = 2500
const H = 843
const AREAS = [
  { label: '近期到期', data: 'query=expiring' },
  { label: '待處理報價', data: 'query=quotes' },
  { label: '進行中專案', data: 'query=projects' },
  { label: '新增專案', data: 'add=project' },
]

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
if (!token) {
  console.error('✗ 缺少 LINE_CHANNEL_ACCESS_TOKEN')
  process.exit(1)
}

async function api(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url} → ${response.status} ${body}`)
  return body ? JSON.parse(body) : {}
}

const cell = Math.floor(W / AREAS.length)

try {
  const { richmenus = [] } = await api('https://api.line.me/v2/bot/richmenu/list')
  for (const old of richmenus.filter((m) => m.name === NAME)) {
    await api(`https://api.line.me/v2/bot/richmenu/${old.richMenuId}`, { method: 'DELETE' })
    console.log(`已刪除舊選單 ${old.richMenuId}`)
  }

  const { richMenuId } = await api('https://api.line.me/v2/bot/richmenu', {
    method: 'POST',
    body: JSON.stringify({
      size: { width: W, height: H },
      selected: true,
      name: NAME,
      chatBarText: '選單',
      areas: AREAS.map((a, i) => ({
        bounds: { x: i * cell, y: 0, width: i === AREAS.length - 1 ? W - i * cell : cell, height: H },
        action: { type: 'postback', label: a.label, data: a.data, displayText: a.label },
      })),
    }),
  })

  const image = readFileSync(path.join(import.meta.dirname, 'assets', 'richmenu.png'))
  await api(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: image,
  })
  await api(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, { method: 'POST' })

  console.log(`✓ 已建立並設為預設選單：${richMenuId}`)
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
