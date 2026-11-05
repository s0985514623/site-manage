import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

/**
 * 登入憑證的加密儲存驗證。
 *
 * 重點是「明文絕不落地」與「換金鑰後失敗要明確可見」——
 * 這份資料等同客戶網站的鑰匙，靜默出錯的代價太高。
 *
 * 執行：npm run verify:credentials
 */

let pass = 0
let fail = 0

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
    console.log(`  ✓ ${label} → ${a}`)
  } else {
    fail++
    console.log(`  ✗ ${label}\n      預期 ${e}\n      實際 ${a}`)
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('拒絕在 production 環境執行')
  }

  const { db } = await import('../src/db')
  const { clients, credentials, services, sites } = await import(
    '../src/db/schema'
  )
  const { eq: whereEq } = await import('drizzle-orm')
  const { decrypt, encrypt } = await import('../src/lib/crypto')
  const { plusDays, today } = await import('../src/lib/dates')

  const [client] = await db
    .insert(clients)
    .values({ name: '[憑證測試] 客戶' })
    .returning()
  const [site] = await db
    .insert(sites)
    .values({ clientId: client.id, name: '[憑證測試] 網站' })
    .returning()
  const [service] = await db
    .insert(services)
    .values({
      siteId: site.id,
      type: 'hosting',
      identifier: '[憑證測試] 主機',
      expiresAt: plusDays(today(), 100),
    })
    .returning()

  try {
    const SECRET = 'P@ssw0rd!中文密碼 with spaces 🔐'

    console.log('\n[寫入]')
    const box = encrypt(SECRET)
    const [row] = await db
      .insert(credentials)
      .values({
        serviceId: service.id,
        label: 'WP 後台',
        url: 'https://example.com/wp-admin',
        username: 'admin',
        secretEncrypted: box.ciphertext,
        secretIv: box.iv,
        secretTag: box.tag,
      })
      .returning()

    eq('已寫入', Boolean(row.id), true)

    console.log('\n[明文不落地]')
    // 直接以原始 SQL 讀出整列，確認任何欄位都找不到明文
    const { sql } = await import('../src/db')
    const raw = await sql`SELECT * FROM credentials WHERE id = ${row.id}`
    const dump = JSON.stringify(raw[0])
    eq('整列 JSON 不含明文密碼', dump.includes(SECRET), false)
    eq('整列 JSON 不含密碼片段', dump.includes('P@ssw0rd'), false)
    eq('密文欄位有值', row.secretEncrypted.length > 0, true)
    eq('IV 欄位有值', row.secretIv.length > 0, true)
    eq('認證標籤有值', row.secretTag.length > 0, true)

    console.log('\n[讀取]')
    const back = decrypt({
      ciphertext: row.secretEncrypted,
      iv: row.secretIv,
      tag: row.secretTag,
    })
    eq('解密後與原文一致', back, SECRET)

    console.log('\n[竄改偵測]')
    let tampered = false
    try {
      const flipped =
        (row.secretEncrypted[0] === 'A' ? 'B' : 'A') +
        row.secretEncrypted.slice(1)
      decrypt({ ciphertext: flipped, iv: row.secretIv, tag: row.secretTag })
    } catch {
      tampered = true
    }
    eq('密文被改過會拋錯，不會吐出錯誤明文', tampered, true)

    let wrongTag = false
    try {
      decrypt({
        ciphertext: row.secretEncrypted,
        iv: row.secretIv,
        tag: encrypt('其他內容').tag,
      })
    } catch {
      wrongTag = true
    }
    eq('認證標籤不符會拋錯', wrongTag, true)

    console.log('\n[每筆獨立 IV]')
    const a = encrypt(SECRET)
    const b = encrypt(SECRET)
    eq('相同明文兩次加密的 IV 不同', a.iv !== b.iv, true)
    eq('相同明文兩次加密的密文不同', a.ciphertext !== b.ciphertext, true)
    eq('但都能解回原文', decrypt(a) === SECRET && decrypt(b) === SECRET, true)

    console.log('\n[連動刪除]')
    await db.delete(services).where(whereEq(services.id, service.id))
    const left = await db.query.credentials.findFirst({
      where: whereEq(credentials.id, row.id),
    })
    eq('服務項目刪除後憑證一併移除', left, undefined)
  } finally {
    await db.delete(sites).where(whereEq(sites.clientId, client.id))
    await db.delete(clients).where(whereEq(clients.id, client.id))
    console.log('\n測試資料已清除')
  }

  console.log(`\n通過 ${pass} 項${fail > 0 ? `，失敗 ${fail} 項` : ''}\n`)
  return fail
}

main()
  .then((f) => process.exit(f === 0 ? 0 : 1))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
