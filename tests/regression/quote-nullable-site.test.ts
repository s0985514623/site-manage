import { describe, expect, it } from 'vitest'

import { db } from '@/db'
import { projects, quotes } from '@/db/schema'
import { renderQuotePdf } from '@/lib/pdf/render'
import { quoteSubjectName } from '@/lib/quote-display'
import { listQuotes } from '@/server/queries'

import { 有客戶 } from '../support/given'

/**
 * 第 1 階段的最大風險（R1）：報價單的 site_id / anchor_date 改為可空後，
 * 舊程式假設非空的地方會讓專案報價消失或印出 undefined。
 */
async function 建立無網站的專案報價() {
  const client = await 有客戶('新夢想創意')
  const [project] = await db
    .insert(projects)
    .values({ clientId: client.id, name: '築苗園區改版', category: 'new_site' })
    .returning()
  const [quote] = await db
    .insert(quotes)
    .values({
      quoteNo: '261116',
      clientId: client.id,
      projectId: project.id,
      issueDate: '2026-11-16',
      validUntil: '2026-11-30',
      total: '50000',
    })
    .returning()
  return { client, project, quote }
}

describe('報價單可以不綁網站', () => {
  it('沒有網站的專案報價會出現在報價列表', async () => {
    const { quote } = await 建立無網站的專案報價()
    const rows = await listQuotes()
    expect(rows.map((r) => r.id)).toContain(quote.id)
    const row = rows.find((r) => r.id === quote.id)!
    expect(row.siteName).toBeNull()
    expect(row.projectName).toBe('築苗園區改版')
  })

  it('顯示名稱：沒有網站時用專案名稱', () => {
    expect(quoteSubjectName({ site: null, project: { name: '築苗園區改版' } })).toBe('築苗園區改版')
    expect(quoteSubjectName({ site: { name: '官網' }, project: { name: '專案' } })).toBe('官網')
  })

  it('沒有網站的專案報價可以產生 PDF', async () => {
    const { quote } = await 建立無網站的專案報價()
    const pdf = await renderQuotePdf(quote.id)
    expect(pdf.buffer.subarray(0, 4).toString()).toBe('%PDF')
  })

  it('網站與專案都沒有的報價單被資料庫拒絕', async () => {
    const client = await 有客戶('孤兒客戶')
    await expect(
      db.insert(quotes).values({
        quoteNo: '261116-9',
        clientId: client.id,
        issueDate: '2026-11-16',
        validUntil: '2026-11-30',
      }),
    ).rejects.toThrow()
  })
})
