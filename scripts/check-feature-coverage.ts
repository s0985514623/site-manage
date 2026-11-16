/**
 * 規格覆蓋檢查：每個 .feature 的 Example / Scenario Outline 都要有同名的測試。
 *
 *   npm run test:coverage-map          已開始實作的 feature 不可缺漏，尚未實作的只列出來
 *   npm run test:coverage-map -- --all 所有 feature 都必須完整覆蓋（全部階段完成後 CI 改用這個）
 *
 * 對應規則：specs/features/<dir>/<名稱>.feature ↔ tests/features/<dir>/<名稱>.test.ts，
 * 測試檔裡要出現與 Example 名稱完全相同的字串（通常是 it('<名稱>', …)）。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const FEATURES_DIR = path.join(process.cwd(), 'specs', 'features')
const TESTS_DIR = path.join(process.cwd(), 'tests', 'features')
const requireAll = process.argv.includes('--all')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.feature') ? [path.join(dir, e.name)] : [],
  )
}

function exampleNames(featureText: string): string[] {
  return [...featureText.matchAll(/^\s*(?:Example|Scenario|Scenario Outline):\s*(.+?)\s*$/gm)].map((m) => m[1])
}

let missingTotal = 0
let covered = 0
let total = 0
const pending: string[] = []

for (const file of walk(FEATURES_DIR).sort()) {
  const rel = path.relative(FEATURES_DIR, file)
  const names = exampleNames(readFileSync(file, 'utf8'))
  total += names.length
  const testFile = path.join(TESTS_DIR, rel.replace(/\.feature$/, '.test.ts'))

  if (!existsSync(testFile)) {
    pending.push(`${rel}（${names.length} 例）`)
    if (requireAll) missingTotal += names.length
    continue
  }

  const testText = readFileSync(testFile, 'utf8')
  const missing = names.filter((n) => !testText.includes(n))
  covered += names.length - missing.length
  if (missing.length > 0) {
    missingTotal += missing.length
    console.log(`✗ ${rel} 缺 ${missing.length} 例：`)
    missing.forEach((n) => console.log(`    - ${n}`))
  } else {
    console.log(`✓ ${rel}（${names.length} 例）`)
  }
}

if (pending.length > 0) {
  console.log(`\n${requireAll ? '✗' : '…'} 尚未有測試檔的 feature（${pending.length} 個）：`)
  pending.forEach((p) => console.log(`    - ${p}`))
}

console.log(`\n已覆蓋 ${covered} / ${total} 例`)
if (missingTotal > 0) {
  console.error(`✗ 缺 ${missingTotal} 例`)
  process.exit(1)
}
