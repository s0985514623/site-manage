/**
 * 驗證中文字型能正確內嵌進 PDF。
 *
 * 為什麼要單獨一支純 .mjs：
 * @react-pdf/renderer 依賴的 @react-pdf/hyphenate 是純 ESM 且 exports map
 * 沒有 require 條件，用 tsx 執行會在解析階段就失敗。Next.js（Turbopack）
 * 自己解析得了，所以正式流程沒問題，但獨立驗證腳本必須走純 Node ESM。
 *
 * 這支腳本驗的是最高風險的那一點：字型沒嵌好時 PDF 不會報錯，
 * 只會在客戶打開時看到一整片空白方框 —— 而那時信已經寄出去了。
 *
 * 執行：npm run verify:font
 */

import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import { createElement as h } from 'react'

let pass = 0
let fail = 0

function eq(label, actual, expected) {
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

const FONT_DIR = path.join(process.cwd(), 'public', 'fonts')

Font.register({
  family: 'NotoSansTC',
  fonts: [
    { src: path.join(FONT_DIR, 'NotoSansTC-Regular.ttf'), fontWeight: 400 },
    { src: path.join(FONT_DIR, 'NotoSansTC-Bold.ttf'), fontWeight: 700 },
  ],
})
Font.registerHyphenationCallback((word) => [word])

const s = StyleSheet.create({
  page: { fontFamily: 'NotoSansTC', fontSize: 10, padding: 40 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 12 },
  row: { flexDirection: 'row', paddingVertical: 4 },
  cell: { width: '50%' },
})

/**
 * 涵蓋報價單會用到的各類字元：常用漢字、罕用姓氏字、全形標點、
 * 貨幣符號、數字。罕用字是重點 —— 客戶公司名稱是自由輸入的。
 */
const SAMPLES = [
  '龍騰國際貿易股份有限公司',
  '網域續約 — example.com.tw（每年）',
  '服務期間 2026/11/08 ~ 2027/11/08',
  'NT$58,590（含 5% 營業稅）',
  '統一編號 12345678　電話 02-1234-5678',
  '罕用字測試：鍾麟犇檞甯邱龔閰麴禤',
  '標點測試：「引號」、『書名』。？！；：…—',
]

async function main() {
  console.log('\n[渲染]')
  const buffer = await renderToBuffer(
    h(
      Document,
      { title: '字型內嵌測試' },
      h(
        Page,
        { size: 'A4', style: s.page },
        h(Text, { style: s.title }, '報價單字型測試'),
        ...SAMPLES.map((line, i) =>
          h(
            View,
            { key: i, style: s.row },
            h(Text, { style: s.cell }, line),
            h(Text, { style: [s.cell, { fontWeight: 700 }] }, line),
          ),
        ),
      ),
    ),
  )

  const out = '.tmp-font-test.pdf'
  await writeFile(out, buffer)

  eq('產生成功', buffer.length > 0, true)
  eq('是合法 PDF', buffer.subarray(0, 4).toString(), '%PDF')
  console.log(`      大小 ${(buffer.length / 1024).toFixed(0)} KB`)
  console.log(`      預覽檔 ${path.resolve(out)}`)

  console.log('\n[字型內嵌]')
  const raw = buffer.toString('latin1')
  // FontFile2 = 內嵌的 TrueType 字型程式。沒有它就代表字型沒嵌進去
  eq('含內嵌 TrueType 字型（FontFile2）', raw.includes('FontFile2'), true)
  eq('字型名稱含 NotoSansTC', /NotoSansTC/.test(raw), true)
  // 兩種字重都要嵌入，否則粗體會退回成預設字型
  const fontFileCount = (raw.match(/FontFile2/g) || []).length
  eq('兩種字重都已內嵌', fontFileCount >= 2, true)
  console.log(`      FontFile2 出現 ${fontFileCount} 次`)

  console.log('\n[字型涵蓋範圍]')
  const { openSync } = await import('fontkit')
  for (const name of ['NotoSansTC-Regular.ttf', 'NotoSansTC-Bold.ttf']) {
    const font = openSync(path.join(FONT_DIR, name))
    const missing = []
    for (const line of SAMPLES) {
      for (const ch of line) {
        if (ch === ' ') continue
        if (!font.hasGlyphForCodePoint(ch.codePointAt(0))) missing.push(ch)
      }
    }
    eq(`${name} 無缺字`, missing, [])
    if (missing.length) console.log(`      缺少：${missing.join('')}`)
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
