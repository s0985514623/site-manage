/**
 * 把指定報價單的 PDF 渲染成檔案，供版面檢查。
 *
 * 為什麼要繞這一圈：
 * @react-pdf/renderer 依賴的套件是純 ESM 且 exports map 沒有 require 條件，
 * tsx 載不進來；而 QuoteDocument 是 .tsx，純 node 又不吃 JSX。
 * 所以先用 esbuild 把整條相依鏈打包成單一 .mjs，再用純 node ESM 執行。
 *
 * 執行：
 *   node scripts/preview-pdf.mjs              最新一張報價單
 *   node scripts/preview-pdf.mjs 260930       指定編號
 */

import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

const wanted = process.argv[2] ?? null

async function main() {
  const { build } = await import('esbuild')
  // 打包產物必須放在專案內，否則 node 解析不到 node_modules（packages 設為 external）
  const outfile = path.resolve('.tmp-render-bundle.mjs')

  // 只打包我們自己的程式碼，node_modules 維持外部相依由 node 自行解析
  await build({
    entryPoints: ['src/lib/pdf/render.tsx'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    packages: 'external',
    jsx: 'automatic',
    logLevel: 'error',
    // tsconfig 的路徑別名 @/* → src/*
    alias: { '@': path.resolve('src') },
    plugins: [
      {
        /**
         * 打包時把 server-only 換成空模組。
         *
         * env.ts 匯入它作為「不可進客戶端打包」的防線，但在純 node 下
         * 它預設解析到會拋錯的版本。改用 --conditions=react-server 雖能
         * 繞過，卻會讓 React 解析成 server 版本而弄壞 @react-pdf 的
         * reconciler。這裡直接抽掉它是唯一兩全的作法。
         */
        name: 'stub-server-only',
        setup(b) {
          b.onResolve({ filter: /^server-only$/ }, () => ({
            path: 'server-only',
            namespace: 'stub',
          }))
          b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: '' }))
        },
      },
    ],
  })

  try {
    const { renderQuotePdf } = await import(pathToFileURL(outfile).href)

    // 取要預覽的報價單。用 postgres 直連，避免再牽一條 TypeScript 相依
    const postgres = (await import('postgres')).default
    const sql = postgres(process.env.DATABASE_URL, { max: 1 })
    const rows = wanted
      ? await sql`select id, quote_no from quotes where quote_no = ${wanted}`
      : await sql`select id, quote_no from quotes order by created_at desc limit 1`
    await sql.end()

    if (rows.length === 0) {
      console.error(
        wanted ? `找不到報價單 ${wanted}` : '資料庫裡沒有任何報價單',
      )
      process.exit(1)
    }

    const { id, quote_no } = rows[0]
    const { buffer } = await renderQuotePdf(id)
    const out = `.tmp-preview-${quote_no}.pdf`
    await writeFile(out, buffer)
    console.log(`${quote_no} → ${path.resolve(out)}（${Math.round(buffer.length / 1024)} KB）`)
    console.log(`\n轉成圖片：python scripts/pdf-to-png.py "${out}"`)
  } finally {
    await rm(outfile, { force: true })
  }
}

main()
  // postgres 連線池會讓 node 不自行結束，明確退出
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
