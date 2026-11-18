import Link from 'next/link'

import { RenewalQuoteButton } from '@/components/renewal-quote-button'
import {
  Badge,
  Card,
  DaysBadge,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui'
import {
  URGENCY_LABEL,
  daysUntil,
  formatTw,
  urgencyOf,
  type Urgency,
} from '@/lib/dates'
import {
  RENEWAL_STATE_LABEL,
  SERVICE_TYPE_ICON,
  SERVICE_TYPE_LABEL,
} from '@/lib/labels'
import { formatMoney } from '@/lib/money'
import { listActiveServices, type ServiceRow } from '@/server/queries'

export const metadata = { title: '到期總表' }
export const dynamic = 'force-dynamic'

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'attention', label: '90 天內' },
  { key: 'ours', label: '我方代管' },
  { key: 'theirs', label: '客戶自管' },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

type Row = ServiceRow

/** 顯示順序刻意把最急的放最上面，逾期永遠第一 */
const GROUP_ORDER: Urgency[] = [
  'overdue',
  'critical',
  'warning',
  'upcoming',
  'safe',
]

const GROUP_STYLE: Record<Urgency, string> = {
  overdue: 'border-overdue/30 bg-overdue-bg text-overdue',
  critical: 'border-critical/30 bg-critical-bg text-critical',
  warning: 'border-warning/30 bg-warning-bg text-warning',
  upcoming: 'border-upcoming/30 bg-upcoming-bg text-upcoming',
  safe: 'border-border bg-surface-muted text-muted',
}

function applyFilter(rows: Row[], filter: FilterKey): Row[] {
  switch (filter) {
    case 'attention':
      return rows.filter((r) => daysUntil(r.expiresAt) <= 90)
    case 'ours':
      return rows.filter((r) => r.isOurs)
    case 'theirs':
      return rows.filter((r) => !r.isOurs)
    default:
      return rows
  }
}

/** 可以開進續約報價的項目：我方代管、有售價、尚未被任何報價單涵蓋 */
function isQuotable(row: Row): boolean {
  return (
    row.isOurs &&
    row.renewalState === 'upcoming' &&
    !row.currentQuoteId &&
    Boolean(row.priceAmount)
  )
}

/**
 * 每個網站只在「最早到期的可報價項目」那一列放按鈕：同一網站的報價會合併，
 * 每列都放會讓人以為要按好幾次。rows 已依到期日排序。
 */
function renewalButtonRows(rows: Row[]): Set<string> {
  const seen = new Set<string>()
  const ids = new Set<string>()
  for (const row of rows) {
    if (!isQuotable(row) || seen.has(row.siteId)) continue
    seen.add(row.siteId)
    ids.add(row.id)
  }
  return ids
}

function ServiceTable({
  rows,
  buttonRows,
}: {
  rows: Row[]
  buttonRows: Set<string>
}) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>項目</Th>
          <Th>客戶 / 網站</Th>
          <Th>供應商</Th>
          <Th>到期日</Th>
          <Th>倒數</Th>
          <Th align="right">售價</Th>
          <Th>續約狀態</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const days = daysUntil(row.expiresAt)
          const conflict =
            row.detectedExpiresAt && row.detectedExpiresAt !== row.expiresAt
          return (
            <tr key={row.id} className="align-top hover:bg-surface-muted">
              <Td>
                <Link
                  href={`/sites/${row.siteId}`}
                  className="font-medium hover:text-accent"
                >
                  <span aria-hidden className="mr-1.5">
                    {SERVICE_TYPE_ICON[row.type]}
                  </span>
                  {row.identifier}
                </Link>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge>{SERVICE_TYPE_LABEL[row.type]}</Badge>
                  {!row.isOurs && <Badge tone="warning">客戶自管</Badge>}
                  {row.isOurs && !row.priceAmount && (
                    <Badge tone="warning">未設售價</Badge>
                  )}
                  {conflict && <Badge tone="warning">到期日有出入</Badge>}
                </div>
              </Td>
              <Td>
                <Link
                  href={`/clients/${row.clientId}`}
                  className="hover:text-accent"
                >
                  {row.clientName}
                </Link>
                <div className="mt-0.5 text-xs text-muted">{row.siteName}</div>
              </Td>
              <Td className="text-muted">{row.provider ?? '—'}</Td>
              <Td className="tabular">{formatTw(row.expiresAt)}</Td>
              <Td>
                <DaysBadge days={days} />
              </Td>
              <Td align="right" className="tabular">
                {row.isOurs
                  ? row.priceAmount
                    ? formatMoney(row.priceAmount, row.currency)
                    : '—'
                  : '—'}
              </Td>
              <Td>
                <Badge
                  tone={
                    row.renewalState === 'pending_approval'
                      ? 'warning'
                      : row.renewalState === 'renewed'
                        ? 'safe'
                        : 'neutral'
                  }
                >
                  {RENEWAL_STATE_LABEL[row.renewalState]}
                </Badge>
              </Td>
              <Td align="right">
                {buttonRows.has(row.id) ? (
                  <RenewalQuoteButton
                    siteId={row.siteId}
                    label="開立續約報價"
                    variant="secondary"
                  />
                ) : row.currentQuoteId ? (
                  <Link
                    href={`/quotes/${row.currentQuoteId}`}
                    className="text-sm whitespace-nowrap text-accent hover:underline"
                  >
                    查看報價單
                  </Link>
                ) : null}
              </Td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}

export default async function ServicesPage({
  searchParams,
}: PageProps<'/services'>) {
  const params = await searchParams
  const raw = typeof params.filter === 'string' ? params.filter : 'attention'
  const filter: FilterKey = FILTERS.some((f) => f.key === raw)
    ? (raw as FilterKey)
    : 'attention'

  const all = await listActiveServices()
  const rows = applyFilter(all, filter)
  // 以「全部項目」決定按鈕位置，篩選後才不會在同網站的較晚項目上多出一顆
  const buttonRows = renewalButtonRows(all)

  const grouped = GROUP_ORDER.map((urgency) => ({
    urgency,
    rows: rows.filter((r) => urgencyOf(daysUntil(r.expiresAt)) === urgency),
  })).filter((g) => g.rows.length > 0)

  const overdueCount = all.filter((r) => daysUntil(r.expiresAt) < 0).length

  return (
    <div>
      <PageHeader
        title="到期總表"
        description={`共 ${all.length} 個使用中的服務項目，依到期日排序`}
      />

      {overdueCount > 0 && (
        <div className="mb-6 rounded-xl border border-overdue/30 bg-overdue-bg px-5 py-4 text-sm text-overdue">
          <strong className="font-bold">有 {overdueCount} 個項目已逾期。</strong>{' '}
          網域過期後通常有約 30 天寬限期、再 30 天贖回期，進入贖回期後費用極高
          （常見 US$100 以上），請優先處理。
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/services?filter=${f.key}`}
            className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              filter === f.key
                ? 'border-accent bg-accent text-accent-foreground'
                : 'border-border text-muted hover:bg-surface-muted hover:text-foreground'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title={
              all.length === 0 ? '還沒有服務項目' : '這個篩選條件下沒有項目'
            }
            description={
              all.length === 0
                ? '先建立客戶與網站，再登記網域、主機等會到期的項目。'
                : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.urgency}>
              <div
                className={`mb-2 inline-block rounded-lg border px-3 py-1 text-sm font-medium ${GROUP_STYLE[group.urgency]}`}
              >
                {URGENCY_LABEL[group.urgency]}
                <span className="tabular ml-2 opacity-70">
                  {group.rows.length}
                </span>
              </div>
              <Card>
                <ServiceTable rows={group.rows} buttonRows={buttonRows} />
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
