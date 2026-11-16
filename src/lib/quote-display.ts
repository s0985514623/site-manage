/**
 * 報價單的「對象名稱」：續約報價用網站名稱，專案報價（可能沒綁網站）用專案名稱。
 *
 * 報價單的 site_id 從第 1 階段起可以是空的。所有要把「哪個網站」印出來的地方
 * （PDF、信件主旨、LINE 確認訊息、列表）都透過這裡取名稱，不直接讀 quote.site.name。
 */

type QuoteLike = {
  projectId?: string | null
  projectName?: string | null
  site?: { name: string } | null
  project?: { name: string } | null
}

export function quoteSubjectName(quote: QuoteLike): string {
  return quote.site?.name ?? quote.project?.name ?? quote.projectName ?? ''
}

/** 續約報價（由到期項目產生）；專案報價為 false */
export function isRenewalQuote(quote: { projectId?: string | null }): boolean {
  return !quote.projectId
}
