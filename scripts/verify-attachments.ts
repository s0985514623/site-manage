import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

/**
 * 回簽附件的驗證。
 *
 * 重點在兩件事：
 * 1. 檔案存進資料庫後能原封不動取回（憑證不能有一個位元組的差異）
 * 2. 偽裝成圖片的檔案會被擋下 —— 這些檔案之後會由瀏覽器開啟
 *
 * 執行：npm run verify:attachments
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

/** 與 src/server/actions/attachments.ts 的 sniff 相同邏輯，用於獨立驗證 */
const MAGIC: { type: string; bytes: number[] }[] = [
  { type: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
]

function sniff(buffer: Buffer): string | null {
  for (const { type, bytes } of MAGIC) {
    if (bytes.every((b, i) => buffer[i] === b)) return type
  }
  const brand = buffer.subarray(4, 12).toString('latin1')
  if (brand.startsWith('ftyphe') || brand.startsWith('ftypmif')) return 'image/heic'
  if (
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('拒絕在 production 環境執行')
  }

  const { db } = await import('../src/db')
  const { clients, quoteAttachments, quotes, sites } = await import(
    '../src/db/schema'
  )
  const { eq: whereEq } = await import('drizzle-orm')
  const { today } = await import('../src/lib/dates')

  console.log('\n[檔案內容辨識]')
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.7\n'),
    Buffer.from('假的 PDF 內容'),
  ])
  eq('PDF 檔頭', sniff(pdf), 'application/pdf')
  eq(
    'PNG 檔頭',
    sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/png',
  )
  eq('JPEG 檔頭', sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  eq(
    'WebP 檔頭',
    sniff(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])),
    'image/webp',
  )

  // 把 HTML 改名成 .pdf 上傳：宣稱的格式與內容對不上，應被拒絕
  const html = Buffer.from('<html><script>alert(1)</script></html>')
  eq('偽裝成 PDF 的 HTML 無法通過辨識', sniff(html), null)
  eq('純文字無法通過辨識', sniff(Buffer.from('just text')), null)

  console.log('\n[存取往返]')
  const [client] = await db
    .insert(clients)
    .values({ name: '[附件測試] 客戶' })
    .returning()
  const [site] = await db
    .insert(sites)
    .values({ clientId: client.id, name: '[附件測試] 網站' })
    .returning()
  const [quote] = await db
    .insert(quotes)
    .values({
      quoteNo: `TEST-${Date.now()}`,
      clientId: client.id,
      siteId: site.id,
      anchorDate: today(),
      issueDate: today(),
      validUntil: today(),
    })
    .returning()

  try {
    // 用一個含各種位元組的檔案，確認 bytea 不會做任何轉換
    const original = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.from([0x00, 0xff, 0x0a, 0x0d, 0x1a]),
      Buffer.from('中文內容與 emoji 🔏', 'utf8'),
      Buffer.alloc(1024, 0xab),
    ])

    const [saved] = await db
      .insert(quoteAttachments)
      .values({
        quoteId: quote.id,
        kind: 'signed_quote',
        filename: '九如基金會 回簽報價單 260930.pdf',
        contentType: 'application/pdf',
        sizeBytes: original.byteLength,
        data: original,
        signedOn: today(),
        uploadedBy: 'test@example.com',
      })
      .returning()

    const back = await db.query.quoteAttachments.findFirst({
      where: whereEq(quoteAttachments.id, saved.id),
    })

    eq('取回的位元組數相同', back?.data.byteLength, original.byteLength)
    eq('內容完全一致', Buffer.compare(back!.data, original), 0)
    eq('中文檔名完整保留', back?.filename, '九如基金會 回簽報價單 260930.pdf')
    eq('大小欄位與實際一致', back?.sizeBytes, original.byteLength)

    console.log('\n[列表查詢不載入檔案本體]')
    const listed = await db.query.quoteAttachments.findMany({
      where: whereEq(quoteAttachments.quoteId, quote.id),
      columns: { id: true, filename: true, sizeBytes: true },
    })
    eq('查得到', listed.length, 1)
    eq(
      '未取出 data 欄位',
      'data' in (listed[0] as Record<string, unknown>),
      false,
    )

    console.log('\n[連動刪除]')
    await db.delete(quotes).where(whereEq(quotes.id, quote.id))
    const orphan = await db.query.quoteAttachments.findFirst({
      where: whereEq(quoteAttachments.id, saved.id),
    })
    eq('報價單刪除後附件一併移除', orphan, undefined)
  } finally {
    await db.delete(quotes).where(whereEq(quotes.siteId, site.id))
    await db.delete(sites).where(whereEq(sites.id, site.id))
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
