import Link from 'next/link'

import { Badge, Card, DaysBadge, Table, Td, Th } from '@/components/ui'
import { daysUntil } from '@/lib/dates'
import { features } from '@/lib/env'
import { SITE_STATUS_LABEL } from '@/lib/labels'
import { getSettings } from '@/lib/settings'
import { dashboardCounts, listSites, type SiteRow } from '@/server/queries'

export const metadata = { title: '儀表板' }
export const dynamic = 'force-dynamic'

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className="tabular mt-1 text-3xl font-bold">{value}</div>
    </div>
  )
}

function SetupRow({ done, label, hint }: { done: boolean; label: string; hint: string }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span
        aria-hidden
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          done
            ? 'bg-safe-bg text-safe'
            : 'bg-surface-muted text-muted'
        }`}
      >
        {done ? '✓' : '·'}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-medium">
          {label}
          <span className={`ml-2 text-xs font-normal ${done ? 'text-safe' : 'text-muted'}`}>
            {done ? '已設定' : '待設定'}
          </span>
        </div>
        {!done && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
    </li>
  )
}

const SITE_STATUS_TONE = {
  building: 'accent',
  live: 'safe',
  paused: 'warning',
  closed: 'neutral',
} as const

function SiteTable({ rows }: { rows: SiteRow[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>網站</Th>
          <Th>客戶</Th>
          <Th>狀態</Th>
          <Th align="right">服務項目</Th>
          <Th>最近到期</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="hover:bg-surface-muted">
            <Td>
              <Link
                href={`/sites/${row.id}`}
                className="font-medium hover:text-accent"
              >
                {row.name}
              </Link>
              {row.primaryUrl && (
                <div className="mt-0.5 truncate text-xs text-muted">
                  {row.primaryUrl.replace(/^https?:\/\//, '')}
                </div>
              )}
            </Td>
            <Td>
              <Link
                href={`/clients/${row.clientId}`}
                className="text-muted hover:text-accent"
              >
                {row.clientName}
              </Link>
            </Td>
            <Td>
              <Badge tone={SITE_STATUS_TONE[row.status]}>
                {SITE_STATUS_LABEL[row.status]}
              </Badge>
            </Td>
            <Td align="right" className="tabular">
              {row.serviceCount}
            </Td>
            <Td>
              {row.nextExpiresAt ? (
                <span className="flex items-center gap-2">
                  <span className="tabular text-muted">{row.nextExpiresAt}</span>
                  <DaysBadge days={daysUntil(row.nextExpiresAt)} />
                </span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </Td>
            <Td align="right">
              <Link
                href={`/sites/${row.id}`}
                className="whitespace-nowrap text-sm text-accent hover:underline"
              >
                管理
              </Link>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

export default async function DashboardPage() {
  const [stat, config, siteRows] = await Promise.all([
    dashboardCounts(),
    getSettings(),
    listSites(),
  ])

  const setupDone =
    features.googleLogin && features.email && features.lineApproval

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">儀表板</h1>
        <p className="mt-1 text-sm text-muted">
          報價觸發設定：錨點剩 {config.quoteTriggerDays} 天時擬草稿，納入其後{' '}
          {config.quoteWindowDays} 天內到期的項目
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="客戶" value={stat.clients} />
        <StatCard label="網站" value={stat.sites} />
        <StatCard label="服務項目" value={stat.services} />
      </div>

      {siteRows.length > 0 && (
        <Card title="網站管理" description="點網站名稱進入管理頁">
          <SiteTable rows={siteRows} />
        </Card>
      )}

      {stat.services === 0 && (
        <div className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-base font-bold">還沒有任何資料</h2>
          <p className="mt-1.5 text-sm text-muted">
            先建立一個客戶，底下掛網站，再把該網站的網域、主機、維護合約
            分別登記為服務項目。每個項目各自有到期日與價格。
          </p>
          <Link
            href="/clients"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
          >
            新增第一個客戶
          </Link>
        </div>
      )}

      {!setupDone && (
        <div className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-base font-bold">外部服務設定</h2>
          <p className="mt-1.5 text-sm text-muted">
            未設定的項目只會讓對應功能停用，不影響系統其他部分運作。
          </p>
          <ul className="mt-4 divide-y divide-border">
            <SetupRow
              done={features.googleLogin}
              label="Google 登入"
              hint="AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET"
            />
            <SetupRow
              done={features.email}
              label="Resend 寄信"
              hint="RESEND_API_KEY / MAIL_FROM，寄件網域需設定 SPF 與 DKIM，否則報價單會進垃圾桶"
            />
            <SetupRow
              done={features.line}
              label="LINE 推播"
              hint="LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET"
            />
            <SetupRow
              done={features.lineApproval}
              label="LINE 審核寄信"
              hint="還需要 LINE_ADMIN_USER_ID。未設定時系統不會自動寄信給客戶，只會通知你"
            />
            <SetupRow
              done={Boolean(config.gcalCalendarId)}
              label="Google Calendar 同步"
              hint="於設定頁授權後自動建立專屬日曆"
            />
          </ul>
        </div>
      )}
    </div>
  )
}
