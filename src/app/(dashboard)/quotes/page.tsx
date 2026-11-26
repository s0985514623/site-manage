import Link from 'next/link'

import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui'
import { formatTw } from '@/lib/dates'
import { QUOTE_STATUS_LABEL } from '@/lib/labels'
import { formatMoney } from '@/lib/money'
import { getSettings } from '@/lib/settings'
import { listQuotes } from '@/server/queries'

export const metadata = { title: '報價單' }
export const dynamic = 'force-dynamic'

const STATUS_TONE = {
  draft: 'neutral',
  pending_approval: 'warning',
  sent: 'accent',
  accepted: 'safe',
  rejected: 'overdue',
  cancelled: 'neutral',
  expired: 'overdue',
} as const

type QuoteStatus = keyof typeof STATUS_TONE

function isQuoteStatus(v: unknown): v is QuoteStatus {
  return typeof v === 'string' && v in STATUS_TONE
}

function FilterLink({
  label,
  status,
  current,
  count,
}: {
  label: string
  status?: QuoteStatus
  current?: QuoteStatus
  count: number
}) {
  const active = status === current
  return (
    <Link
      href={status ? `/quotes?status=${status}` : '/quotes'}
      className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
        active ? 'bg-accent text-white' : 'text-muted hover:bg-surface-muted hover:text-foreground'
      }`}
    >
      {label}
      <span className={`ml-1 tabular ${active ? 'text-white/80' : 'text-muted'}`}>{count}</span>
    </Link>
  )
}

export default async function QuotesPage({ searchParams }: PageProps<'/quotes'>) {
  const sp = await searchParams
  const status = isQuoteStatus(sp.status) ? sp.status : undefined
  const [allRows, config] = await Promise.all([listQuotes(), getSettings()])
  const rows = status ? allRows.filter((r) => r.status === status) : allRows
  const counts = allRows.reduce<Partial<Record<QuoteStatus, number>>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div>
      <PageHeader
        title="報價單"
        description="系統會在到期前自動擬好草稿推到 LINE，由你確認後才寄給客戶"
      />

      <Card>
        {allRows.length > 0 && (
          <div className="flex flex-wrap gap-1 border-b border-border px-4 py-3">
            <FilterLink label="全部" current={status} count={allRows.length} />
            {(Object.keys(STATUS_TONE) as QuoteStatus[]).map((value) => (
              <FilterLink
                key={value}
                label={QUOTE_STATUS_LABEL[value]}
                status={value}
                current={status}
                count={counts[value] ?? 0}
              />
            ))}
          </div>
        )}

        {allRows.length > 0 && rows.length === 0 ? (
          <EmptyState title={`沒有「${status ? QUOTE_STATUS_LABEL[status] : ''}」的報價單`} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="還沒有報價單"
            description={`當某個網站最早到期的項目剩下 ${config.quoteTriggerDays} 天時，系統會自動把該網站在那之後 ${config.quoteWindowDays} 天內到期的項目合併成一張報價單草稿。`}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>編號</Th>
                <Th>客戶 / 網站</Th>
                <Th>開立日</Th>
                <Th>有效至</Th>
                <Th align="right">合計</Th>
                <Th>狀態</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-surface-muted">
                  <Td className="tabular font-medium">{row.quoteNo}</Td>
                  <Td>
                    {row.clientName}
                    <div className="mt-0.5 text-xs text-muted">
                      {row.siteName ?? (row.projectName && `專案：${row.projectName}`)}
                    </div>
                  </Td>
                  <Td className="tabular text-muted">
                    {formatTw(row.issueDate)}
                  </Td>
                  <Td className="tabular text-muted">
                    {formatTw(row.validUntil)}
                  </Td>
                  <Td align="right" className="tabular font-medium">
                    {formatMoney(row.total, row.currency)}
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[row.status]}>
                      {QUOTE_STATUS_LABEL[row.status]}
                    </Badge>
                  </Td>
                  <Td align="right">
                    <Link
                      href={`/quotes/${row.id}`}
                      className="text-sm text-accent hover:underline"
                    >
                      查看
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
