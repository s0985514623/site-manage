import Link from 'next/link'

import { ActionForm, Disclosure } from '@/components/action-form'
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui'
import { formatTw } from '@/lib/dates'
import { createProjectAction } from '@/server/actions/projects'
import { projectFormOptions } from '@/server/projects/options'
import { CATEGORY_LABEL, listProjects, STATUS_LABEL } from '@/server/projects/projects'
import { ProjectFields, STATUS_TONE } from './project-fields'

export const metadata = { title: '專案' }
export const dynamic = 'force-dynamic'

function FilterLink({
  label,
  params,
  current,
}: {
  label: string
  params: { category?: string; status?: string }
  current: { category?: string; status?: string }
}) {
  const active = params.category === current.category && params.status === current.status
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v) as [string, string][],
  ).toString()
  return (
    <Link
      href={`/projects${query ? `?${query}` : ''}`}
      className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
        active ? 'bg-accent text-white' : 'text-muted hover:bg-surface-muted hover:text-foreground'
      }`}
    >
      {label}
    </Link>
  )
}

export default async function ProjectsPage({ searchParams }: PageProps<'/projects'>) {
  const sp = await searchParams
  const filter = {
    category: typeof sp.category === 'string' ? sp.category : undefined,
    status: typeof sp.status === 'string' ? sp.status : undefined,
  }
  const [rows, options] = await Promise.all([listProjects(filter), projectFormOptions()])

  return (
    <div className="space-y-6">
      <PageHeader
        title="專案"
        description="新網站製作、客製化外掛、BUG 排除等。截止日與里程碑會寫入 Google「專案管理」日曆。"
      />

      <Disclosure label="新增專案">
        <ActionForm action={createProjectAction} submitLabel="建立專案">
          <ProjectFields clients={options.clients} sites={options.sites} />
        </ActionForm>
      </Disclosure>

      <Card>
        <div className="flex flex-wrap gap-1 border-b border-border px-4 py-3">
          <FilterLink label="全部" params={{}} current={filter} />
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <FilterLink key={value} label={label} params={{ status: value }} current={filter} />
          ))}
          <span className="mx-2 border-l border-border" />
          {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
            <FilterLink key={value} label={label} params={{ category: value }} current={filter} />
          ))}
        </div>

        {rows.length === 0 ? (
          <EmptyState title="沒有符合條件的專案" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>專案</Th>
                <Th>類別</Th>
                <Th>狀態</Th>
                <Th>截止日</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-surface-muted">
                  <Td>
                    <Link href={`/projects/${row.id}`} className="font-medium hover:text-accent hover:underline">
                      {row.name}
                    </Link>
                    <div className="mt-0.5 text-xs text-muted">{row.clientName}</div>
                  </Td>
                  <Td className="text-muted">{CATEGORY_LABEL[row.category]}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                      {row.handoverPending && <Badge tone="warning">待轉維運</Badge>}
                    </span>
                  </Td>
                  <Td className="tabular">
                    {row.dueDate ? formatTw(row.dueDate) : <span className="text-muted">—</span>}
                    {row.overdue && (
                      <span className="ml-2">
                        <Badge tone="overdue">逾期</Badge>
                      </span>
                    )}
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
