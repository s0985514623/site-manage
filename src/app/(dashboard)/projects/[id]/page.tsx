import { desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ActionForm, ConfirmForm, Disclosure } from '@/components/action-form'
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from '@/components/ui'
import { db } from '@/db'
import { projects, quotes } from '@/db/schema'
import { formatTw, today } from '@/lib/dates'
import { QUOTE_STATUS_LABEL } from '@/lib/labels'
import { formatMoney } from '@/lib/money'
import {
  addMilestoneAction,
  deleteMilestoneAction,
  deleteProjectAction,
  toggleMilestoneAction,
  updateMilestoneAction,
  updateProjectAction,
  updateProjectStatusAction,
} from '@/server/actions/projects'
import { listMilestones } from '@/server/projects/milestones'
import { projectFormOptions } from '@/server/projects/options'
import { CATEGORY_LABEL, handoverRequired, STATUS_LABEL } from '@/server/projects/projects'
import { ProjectFields, STATUS_TONE } from '../project-fields'
import { HandoverSection } from './handover-section'
import { ProjectQuoteSection } from './quote-section'

export const dynamic = 'force-dynamic'

async function getProject(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined
  return db.query.projects.findFirst({
    where: eq(projects.id, id),
    with: { client: true, site: true },
  })
}

export async function generateMetadata({ params }: PageProps<'/projects/[id]'>) {
  const { id } = await params
  const project = await getProject(id)
  return { title: project?.name ?? '專案' }
}

export default async function ProjectDetailPage({ params }: PageProps<'/projects/[id]'>) {
  const { id } = await params
  const project = await getProject(id)
  if (!project) notFound()

  const [milestones, options, projectQuotes] = await Promise.all([
    listMilestones(project.id),
    projectFormOptions(),
    db.query.quotes.findMany({
      where: eq(quotes.projectId, project.id),
      orderBy: [desc(quotes.createdAt)],
    }),
  ])
  const now = today()
  const showHandover = handoverRequired(project)

  return (
    <div className="space-y-6">
      <PageHeader
        title={project.name}
        back={{ href: '/projects', label: '專案列表' }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[project.status]}>{STATUS_LABEL[project.status]}</Badge>
            <span>{CATEGORY_LABEL[project.category]}</span>
            <span>·</span>
            <Link href={`/clients/${project.clientId}`} className="hover:text-accent hover:underline">
              {project.client.name}
            </Link>
            {project.site && (
              <>
                <span>·</span>
                <Link href={`/sites/${project.site.id}`} className="hover:text-accent hover:underline">
                  {project.site.name}
                </Link>
              </>
            )}
            {project.dueDate && (
              <>
                <span>·</span>
                <span>截止 {formatTw(project.dueDate)}</span>
              </>
            )}
            {project.dueDate && !project.gcalEventId && (
              <Badge tone="warning">日曆未同步</Badge>
            )}
          </span>
        }
      />

      {showHandover && <HandoverSection project={project} />}

      <Card title="狀態">
        <div className="p-5">
          <ActionForm action={updateProjectStatusAction} submitLabel="更新狀態">
            <input type="hidden" name="id" value={project.id} />
            <Field label="目前狀態" className="max-w-xs">
              <Select name="status" defaultValue={project.status}>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </ActionForm>
          {project.handoverCompletedAt && (
            <p className="mt-3 text-sm text-safe">
              已於 {formatTw(project.handoverCompletedAt.toISOString().slice(0, 10))} 轉維運
            </p>
          )}
        </div>
      </Card>

      <Card
        title="里程碑"
        description="每個里程碑都會寫入 Google「專案管理」日曆，完成後事件保留"
      >
        {milestones.length === 0 ? (
          <EmptyState title="還沒有里程碑" description="例如：設計稿確認、上線、驗收" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>里程碑</Th>
                <Th>日期</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {milestones.map((m) => (
                <tr key={m.id}>
                  <Td>
                    <span className={m.completedAt ? 'text-muted line-through' : 'font-medium'}>
                      {m.name}
                    </span>
                    {!m.completedAt && m.dueOn < now && (
                      <span className="ml-2">
                        <Badge tone="overdue">逾期</Badge>
                      </span>
                    )}
                    {!m.gcalEventId && (
                      <span className="ml-2">
                        <Badge tone="warning">日曆未同步</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="tabular">{formatTw(m.dueOn)}</Td>
                  <Td>
                    <div className="flex flex-wrap items-start justify-end gap-2">
                      <ActionForm
                        action={toggleMilestoneAction}
                        submitLabel={m.completedAt ? '取消完成' : '標記完成'}
                        submitVariant="secondary"
                        className="[&>div]:mt-0"
                      >
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="projectId" value={project.id} />
                      </ActionForm>
                      <Disclosure label="修改">
                        <ActionForm action={updateMilestoneAction} submitLabel="儲存">
                          <input type="hidden" name="id" value={m.id} />
                          <input type="hidden" name="projectId" value={project.id} />
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="名稱" required>
                              <Input name="name" required defaultValue={m.name} />
                            </Field>
                            <Field label="日期" required>
                              <Input type="date" name="dueOn" required defaultValue={m.dueOn} />
                            </Field>
                          </div>
                        </ActionForm>
                      </Disclosure>
                      <ConfirmForm
                        action={deleteMilestoneAction}
                        label="刪除"
                        confirmLabel="確定刪除"
                        message="日曆上的事件也會一併刪除。"
                      >
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="projectId" value={project.id} />
                      </ConfirmForm>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="border-t border-border p-5">
          <ActionForm action={addMilestoneAction} submitLabel="新增里程碑" resetOnSuccess>
            <input type="hidden" name="projectId" value={project.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="名稱" required>
                <Input name="name" required placeholder="設計稿確認" />
              </Field>
              <Field label="日期" required>
                <Input type="date" name="dueOn" required />
              </Field>
            </div>
          </ActionForm>
        </div>
      </Card>

      <ProjectQuoteSection project={project} quotes={projectQuotes} />

      {projectQuotes.length > 0 && (
        <Card title="報價單">
          <Table>
            <thead>
              <tr>
                <Th>單號</Th>
                <Th>開立</Th>
                <Th align="right">合計</Th>
                <Th>狀態</Th>
              </tr>
            </thead>
            <tbody>
              {projectQuotes.map((q) => (
                <tr key={q.id} className="hover:bg-surface-muted">
                  <Td>
                    <Link href={`/quotes/${q.id}`} className="tabular font-medium hover:text-accent hover:underline">
                      {q.quoteNo}
                    </Link>
                  </Td>
                  <Td className="tabular text-muted">{formatTw(q.issueDate)}</Td>
                  <Td align="right" className="tabular">
                    {formatMoney(q.total, q.currency)}
                  </Td>
                  <Td>
                    <Badge>{QUOTE_STATUS_LABEL[q.status]}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card title="專案資料">
        <div className="p-5">
          <ActionForm action={updateProjectAction} submitLabel="儲存">
            <input type="hidden" name="id" value={project.id} />
            <ProjectFields clients={options.clients} sites={options.sites} project={project} />
          </ActionForm>
        </div>
      </Card>

      <Card title="刪除專案">
        <div className="p-5">
          <ConfirmForm
            action={deleteProjectAction}
            label="刪除專案"
            confirmLabel="確定刪除"
            message="里程碑與日曆事件會一併刪除。已有報價單的專案不能刪除。"
          >
            <input type="hidden" name="id" value={project.id} />
          </ConfirmForm>
        </div>
      </Card>
    </div>
  )
}
