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

/** 名稱欄的建議選項，可以直接打其他名稱 */
const PHASE_SUGGESTIONS = ['需求訪談', '設計', '設計稿確認', '前端開發', '後端開發', '內容建置', '測試驗收', '上線']

/** 時程 / 里程碑欄位：開始日留空就是單日里程碑 */
function ScheduleFields({
  name,
  startOn,
  dueOn,
}: {
  name?: string
  startOn?: string | null
  dueOn?: string
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="名稱" required>
        <Input name="name" required defaultValue={name} placeholder="前端開發" list="phase-suggestions" />
      </Field>
      <Field label="開始日" hint="留空 = 單日里程碑">
        <Input type="date" name="startOn" defaultValue={startOn ?? ''} />
      </Field>
      <Field label="結束日" required>
        <Input type="date" name="dueOn" required defaultValue={dueOn} />
      </Field>
    </div>
  )
}

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
        title="時程與里程碑"
        description="可以自由新增多段時程（例：前端開發 11/20–12/10），每段都會以跨日事件寫入 Google「專案管理」日曆；只填結束日就是單日里程碑"
      >
        <datalist id="phase-suggestions">
          {PHASE_SUGGESTIONS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        {milestones.length === 0 ? (
          <EmptyState
            title="還沒有時程"
            description="例如：需求訪談、設計、前端開發、後端開發、測試驗收、上線"
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>名稱</Th>
                <Th>期間</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {milestones.map((m) => {
                const running = !m.completedAt && m.startOn && m.startOn <= now && now <= m.dueOn
                return (
                  <tr key={m.id}>
                    <Td>
                      <span className={m.completedAt ? 'text-muted line-through' : 'font-medium'}>
                        {m.name}
                      </span>
                      <span className="ml-2 text-xs text-muted">{m.startOn ? '時程' : '里程碑'}</span>
                      {running && (
                        <span className="ml-2">
                          <Badge tone="accent">進行中</Badge>
                        </span>
                      )}
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
                    <Td className="tabular whitespace-nowrap">
                      {m.startOn ? `${formatTw(m.startOn)} – ${formatTw(m.dueOn)}` : formatTw(m.dueOn)}
                    </Td>
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
                            <ScheduleFields name={m.name} startOn={m.startOn} dueOn={m.dueOn} />
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
                )
              })}
            </tbody>
          </Table>
        )}
        <div className="border-t border-border p-5">
          <ActionForm action={addMilestoneAction} submitLabel="新增時程" resetOnSuccess>
            <input type="hidden" name="projectId" value={project.id} />
            <ScheduleFields />
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
