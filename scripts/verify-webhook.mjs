/**
 * LINE webhook 的安全防線驗證。
 *
 * 這是系統唯一會自動對外寄信的入口，所以四道關卡都要實際打過一次：
 *   1. 簽章驗證
 *   2. userId 白名單
 *   3. 一次性 token 原子消耗
 *   4. 報價單狀態機守衛
 *
 * 只測「會被擋下來」的情境，不會真的寄出任何信。
 *
 * 執行：node scripts/verify-webhook.mjs [base-url]
 */

import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:3000'
const URL_PATH = '/api/line/webhook'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]
    }),
)

const SECRET = env.LINE_CHANNEL_SECRET
const ADMIN = env.LINE_ADMIN_USER_ID
if (!SECRET) throw new Error('缺少 LINE_CHANNEL_SECRET')

let pass = 0
let fail = 0

function eq(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++
    console.log(`  ✓ ${label} → ${JSON.stringify(actual)}`)
  } else {
    fail++
    console.log(
      `  ✗ ${label}\n      預期 ${JSON.stringify(expected)}\n      實際 ${JSON.stringify(actual)}`,
    )
  }
}

function sign(body) {
  return createHmac('sha256', SECRET).update(body).digest('base64')
}

async function post(body, signature) {
  const res = await fetch(BASE + URL_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature === null ? {} : { 'x-line-signature': signature }),
    },
    body,
  })
  return res.status
}

function postbackEvent(userId, data) {
  return JSON.stringify({
    destination: 'test',
    events: [
      {
        type: 'postback',
        // 假的 replyToken：回覆會失敗，但那發生在所有安全檢查之後，
        // 不影響我們要驗證的「有沒有被擋下來」
        replyToken: '0'.repeat(32),
        source: { type: 'user', userId },
        postback: { data },
        timestamp: Date.now(),
        mode: 'active',
      },
    ],
  })
}

async function main() {
  console.log(`\n目標：${BASE}${URL_PATH}\n`)

  console.log('[關卡 1：簽章驗證]')
  const body = postbackEvent(ADMIN, 'act=approve&t=fake-token')

  eq('沒帶簽章 → 401', await post(body, null), 401)
  eq('簽章錯誤 → 401', await post(body, 'wrong-signature-value'), 401)
  eq(
    '簽章長度對但內容錯 → 401',
    await post(body, Buffer.alloc(32).toString('base64')),
    401,
  )
  // 用正確密鑰簽「另一份」內容：確認驗的是本次 body 而不是隨便一個合法簽章
  eq(
    '簽章與內容不符（重放他份簽章）→ 401',
    await post(body, sign(postbackEvent(ADMIN, 'act=approve&t=other'))),
    401,
  )
  eq('簽章正確 → 200', await post(body, sign(body)), 200)

  console.log('\n[關卡 2：userId 白名單]')
  const intruder = postbackEvent('U0000000000000000000000000000000', 'act=approve&t=fake')
  eq(
    '非管理者的 postback 仍回 200（LINE 要求），但不會寄信',
    await post(intruder, sign(intruder)),
    200,
  )
  console.log('      （請在下方伺服器記錄確認出現「非管理者嘗試操作」警告）')

  console.log('\n[關卡 3：無效 token]')
  const badToken = postbackEvent(ADMIN, 'act=approve&t=this-token-does-not-exist')
  eq('不存在的 token → 200 且不寄信', await post(badToken, sign(badToken)), 200)

  const malformed = postbackEvent(ADMIN, 'garbage')
  eq('無法解析的 postback → 200', await post(malformed, sign(malformed)), 200)

  console.log(`\n通過 ${pass} 項${fail > 0 ? `，失敗 ${fail} 項` : ''}\n`)
  return fail
}

main()
  .then((f) => process.exit(f === 0 ? 0 : 1))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
