import { sql } from 'drizzle-orm'

import type { db as Database } from '@/db'
import { quotes } from '@/db/schema'
import type { DateStr } from './dates'

type Tx = Parameters<Parameters<typeof Database.transaction>[0]>[0]

/**
 * 報價單編號：YYMMDD，沿用你現有檔案的慣例（例如 260929）。
 *
 * 系統可能同一天產生多張（一個客戶兩個網站就會），此時第二張起加後綴：
 *   260929、260929-2、260929-3
 * 罕見情況才會看到後綴，日常編號與你過去的檔案完全一致。
 *
 * 必須在交易內呼叫。quote_no 上有唯一索引作為最後防線。
 */
export async function nextQuoteNo(tx: Tx, issueDate: DateStr): Promise<string> {
  const base = yymmdd(issueDate)

  // 取出今天已存在的所有編號，在 JS 裡算下一個後綴。
  // 不用 SQL 字串運算，避免先前 substring(x from $1) 那種型別多載歧義。
  const rows = await tx
    .select({ quoteNo: quotes.quoteNo })
    .from(quotes)
    .where(sql`${quotes.quoteNo} = ${base} or ${quotes.quoteNo} like ${base + '-%'}`)

  if (rows.length === 0) return base

  let maxSeq = 1
  for (const { quoteNo } of rows) {
    if (quoteNo === base) continue
    const seq = Number(quoteNo.slice(base.length + 1))
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq
  }
  return `${base}-${maxSeq + 1}`
}

/** '2026-09-29' → '260929' */
export function yymmdd(date: DateStr): string {
  return date.slice(2).replace(/-/g, '')
}
