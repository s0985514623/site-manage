import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

/**
 * 逐一執行各頁面實際使用的查詢。
 *
 * 型別檢查抓不到 Drizzle 的執行期錯誤（join 條件寫錯、欄位不存在、
 * relation 沒宣告），這些只有真的送到資料庫才會爆。這支腳本把所有
 * 查詢跑過一遍，等同於把每個頁面渲染一次。
 *
 * 執行：npm run verify:queries
 */

let failures = 0

async function check(name: string, fn: () => Promise<unknown>) {
  try {
    const result = await fn()
    const size = Array.isArray(result)
      ? `${result.length} 筆`
      : result === null || result === undefined
        ? '無資料'
        : 'ok'
    console.log(`  ✓ ${name} — ${size}`)
    return result
  } catch (error) {
    failures++
    console.error(`  ✗ ${name}`)
    console.error(`    ${error instanceof Error ? error.message : error}`)
    return null
  }
}

async function main() {
  const q = await import('../src/server/queries')
  const { getSettings } = await import('../src/lib/settings')
  const { daysUntil, urgencyOf } = await import('../src/lib/dates')

  console.log('\n[頁面查詢]')
  await check('儀表板 dashboardCounts()', q.dashboardCounts)
  await check('設定 getSettings()', getSettings)
  const clientRows = (await check('客戶列表 listClients()', q.listClients)) as
    | Awaited<ReturnType<typeof q.listClients>>
    | null
  const serviceRows = (await check(
    '到期總表 listActiveServices()',
    q.listActiveServices,
  )) as Awaited<ReturnType<typeof q.listActiveServices>> | null
  await check('報價單列表 listQuotes()', q.listQuotes)
  await check('網站列表 listSites()', q.listSites)

  if (clientRows?.length) {
    const id = clientRows[0].id
    await check('客戶詳情 getClientDetail()', () => q.getClientDetail(id))
  }
  if (serviceRows?.length) {
    const siteId = serviceRows[0].siteId
    await check('網站詳情 getSiteDetail()', () => q.getSiteDetail(siteId))
  }

  // 找不存在的 id 應該回傳 null 而不是拋錯（頁面會導到 404）
  await check('客戶詳情（不存在的 id 應回傳 null）', () =>
    q.getClientDetail('00000000-0000-0000-0000-000000000000'),
  )

  if (serviceRows?.length) {
    console.log('\n[到期總表內容]')
    for (const row of serviceRows) {
      const days = daysUntil(row.expiresAt)
      const flags = [
        row.isOurs ? '代管' : '客戶自管',
        row.isOurs && !row.priceAmount ? '未設售價' : null,
      ]
        .filter(Boolean)
        .join(' / ')
      console.log(
        `  ${row.expiresAt}  ${String(days).padStart(5)} 天  ` +
          `${urgencyOf(days).padEnd(9)} ${row.clientName} · ${row.siteName} · ${row.identifier}  [${flags}]`,
      )
    }
  }

  console.log(
    failures === 0
      ? '\n全部查詢執行成功\n'
      : `\n有 ${failures} 個查詢失敗\n`,
  )
  return failures
}

main()
  .then((f) => process.exit(f === 0 ? 0 : 1))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
