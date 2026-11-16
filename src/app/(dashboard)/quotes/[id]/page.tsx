import Link from 'next/link'
import { notFound } from 'next/navigation'
import { asc, desc, eq } from 'drizzle-orm'

import { ActionForm, ConfirmForm, Disclosure } from '@/components/action-form'
import {
  Badge,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Select,
  Table,
  Td,
  Textarea,
  Th,
} from '@/components/ui'
import { db } from '@/db'
import { quoteAttachments, quoteItems, quotes } from '@/db/schema'
import { formatPeriod, formatTw } from '@/lib/dates'
import { features } from '@/lib/env'
import { QUOTE_STATUS_LABEL } from '@/lib/labels'
import { formatMoney } from '@/lib/money'
import {
  cancelQuoteAction,
  markAccepted,
  markQuoteRenewed,
  markRejected,
  sendQuote,
} from '@/server/actions/quotes'
import {
  deleteAttachment,
  uploadAttachment,
} from '@/server/actions/attachments'
import { quoteRecipients } from '@/server/queries'

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

async function getQuote(id: string) {
  return db.query.quotes.findFirst({
    where: eq(quotes.id, id),
    with: {
      client: true,
      site: true,
      project: true,
      items: { orderBy: [asc(quoteItems.sortOrder)] },
      attachments: {
        // 刻意不取 data：那是檔案本體，開個頁面不該把幾 MB 讀進記憶體
        columns: {
          id: true,
          kind: true,
          filename: true,
          contentType: true,
          sizeBytes: true,
          signedOn: true,
          note: true,
          uploadedBy: true,
          createdAt: true,
        },
        orderBy: [desc(quoteAttachments.createdAt)],
      },
    },
  })
}

export async function generateMetadata({ params }: PageProps<'/quotes/[id]'>) {
  const { id } = await params
  const quote = await db.query.quotes.findFirst({ where: eq(quotes.id, id) })
  return { title: quote?.quoteNo ?? '報價單' }
}


const ATTACHMENT_KIND_LABEL = {
  signed_quote: '回簽報價單',
  payment_proof: '匯款證明',
  other: '其他',
} as const

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular mt-0.5 text-sm font-medium">{value}</div>
    </div>
  )
}

export default async function QuoteDetailPage({
  params,
}: PageProps<'/quotes/[id]'>) {
  const { id } = await params
  const quote = await getQuote(id)
  if (!quote) notFound()

  const recipients = await quoteRecipients(quote.clientId)
  const canSend =
    quote.status === 'draft' || quote.status === 'pending_approval'
  const isClosed =
    quote.status === 'cancelled' ||
    quote.status === 'rejected' ||
    quote.status === 'expired'

  return (
    <div className="space-y-6">
      <PageHeader
        title={quote.quoteNo}
        back={{ href: '/quotes', label: '報價單列表' }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[quote.status]}>
              {QUOTE_STATUS_LABEL[quote.status]}
            </Badge>
            <Link
              href={`/clients/${quote.clientId}`}
              className="hover:text-accent hover:underline"
            >
              {quote.client.name}
            </Link>
            {quote.site && (
              <>
                <span>·</span>
                <Link
                  href={`/sites/${quote.site.id}`}
                  className="hover:text-accent hover:underline"
                >
                  {quote.site.name}
                </Link>
              </>
            )}
            {quote.project && (
              <>
                <span>·</span>
                <Link
                  href={`/projects/${quote.project.id}`}
                  className="hover:text-accent hover:underline"
                >
                  專案：{quote.project.name}
                </Link>
              </>
            )}
          </span>
        }
        action={
          <LinkButton href={`/api/quotes/${quote.id}/pdf`} variant="secondary">
            檢視 PDF
          </LinkButton>
        }
      />

      {quote.status === 'pending_approval' && (
        <div className="rounded-xl border border-warning/30 bg-warning-bg px-5 py-4 text-sm text-warning">
          已推播到 LINE 等你確認。你可以在 LINE 上按「確認寄出」，
          也可以在這個頁面直接處理——兩邊只會生效一次。
        </div>
      )}

      {recipients.length === 0 && canSend && (
        <div className="rounded-xl border border-overdue/30 bg-overdue-bg px-5 py-4 text-sm text-overdue">
          這個客戶沒有設定報價單收件人，無法寄出。請先到{' '}
          <Link
            href={`/clients/${quote.clientId}`}
            className="font-medium underline"
          >
            客戶頁面
          </Link>{' '}
          替至少一位聯絡人勾選「接收報價單」並填寫 Email。
        </div>
      )}

      <Card>
        <div className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
          <Meta label="開立日期" value={formatTw(quote.issueDate)} />
          <Meta label="報價有效至" value={formatTw(quote.validUntil)} />
          <Meta
            label="合併基準日"
            value={quote.anchorDate ? formatTw(quote.anchorDate) : '—（專案報價）'}
          />
          <Meta
            label="合計"
            value={formatMoney(quote.total, quote.currency)}
          />
        </div>

        <Table>
          <thead>
            <tr>
              <Th>項目</Th>
              <Th>服務期間</Th>
              <Th align="right">金額</Th>
            </tr>
          </thead>
          <tbody>
            {quote.items.map((item) => {
              const [name] = item.description.split('（')
              return (
                <tr key={item.id}>
                  <Td>{name.trim()}</Td>
                  <Td className="tabular text-muted">
                    {item.periodStart && item.periodEnd
                      ? formatPeriod(item.periodStart, item.periodEnd)
                      : '—'}
                  </Td>
                  <Td align="right" className="tabular">
                    {formatMoney(item.amount, quote.currency)}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>

        <div className="flex justify-end p-5">
          <dl className="w-64 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">
                {quote.taxMode === 'inclusive' ? '未稅小計' : '小計'}
              </dt>
              <dd className="tabular">
                {formatMoney(quote.subtotal, quote.currency)}
              </dd>
            </div>
            {quote.taxMode !== 'none' && (
              <div className="flex justify-between">
                <dt className="text-muted">
                  營業稅 {Math.round(Number(quote.taxRate) * 100)}%
                </dt>
                <dd className="tabular">
                  {formatMoney(quote.taxAmount, quote.currency)}
                </dd>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-1.5 font-bold">
              <dt>合計</dt>
              <dd className="tabular text-base">
                {formatMoney(quote.total, quote.currency)}
              </dd>
            </div>
          </dl>
        </div>
      </Card>

      {quote.sentAt && (
        <Card title="寄送紀錄">
          <div className="p-5 text-sm">
            <p>
              寄出時間{' '}
              <span className="tabular">
                {quote.sentAt.toLocaleString('zh-TW', {
                  timeZone: 'Asia/Taipei',
                })}
              </span>
            </p>
            <p className="mt-2 text-muted">
              收件人：{(quote.sentTo ?? []).join('、') || '—'}
            </p>
          </div>
        </Card>
      )}

      <Card
        title="回簽與憑證"
        description="客戶簽回的報價單、匯款證明。檔案存在資料庫裡，會隨資料庫一起備份"
      >
        {quote.attachments.length === 0 ? (
          <EmptyState
            title="還沒有上傳任何檔案"
            description="客戶簽回報價單後，把掃描檔或照片上傳存檔，日後對帳與爭議時就有憑據。"
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>檔案</Th>
                <Th>類型</Th>
                <Th>回簽日</Th>
                <Th align="right">大小</Th>
                <Th>上傳時間</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {quote.attachments.map((file) => (
                <tr key={file.id} className="align-top hover:bg-surface-muted">
                  <Td>
                    <a
                      href={`/api/attachments/${file.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-accent hover:underline"
                    >
                      {file.filename}
                    </a>
                    {file.note && (
                      <div className="mt-0.5 text-xs text-muted">{file.note}</div>
                    )}
                  </Td>
                  <Td>
                    <Badge
                      tone={file.kind === 'signed_quote' ? 'safe' : 'neutral'}
                    >
                      {ATTACHMENT_KIND_LABEL[file.kind]}
                    </Badge>
                  </Td>
                  <Td className="tabular text-muted">
                    {file.signedOn ? formatTw(file.signedOn) : '—'}
                  </Td>
                  <Td align="right" className="tabular text-muted">
                    {formatBytes(file.sizeBytes)}
                  </Td>
                  <Td className="tabular text-xs text-muted">
                    {file.createdAt.toLocaleString('zh-TW', {
                      timeZone: 'Asia/Taipei',
                    })}
                  </Td>
                  <Td align="right">
                    <div className="flex items-center justify-end gap-3">
                      <a
                        href={`/api/attachments/${file.id}?download=1`}
                        className="text-sm text-accent hover:underline"
                      >
                        下載
                      </a>
                      <details>
                        <summary className="cursor-pointer list-none text-sm text-muted hover:text-foreground">
                          刪除
                        </summary>
                        <div className="mt-3 w-64 text-left">
                          <ConfirmForm
                            action={deleteAttachment}
                            label="刪除這個檔案"
                            confirmLabel="確定刪除"
                            message="刪除後無法復原。"
                          >
                            <input type="hidden" name="id" value={file.id} />
                            <input
                              type="hidden"
                              name="quoteId"
                              value={quote.id}
                            />
                          </ConfirmForm>
                        </div>
                      </details>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        <div className="border-t border-border p-5">
          <Disclosure label="上傳檔案">
            <ActionForm
              action={uploadAttachment}
              submitLabel="上傳"
              resetOnSuccess
            >
              <input type="hidden" name="quoteId" value={quote.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="檔案"
                  required
                  className="sm:col-span-2"
                  hint="PDF、JPG、PNG、HEIC、WebP，單檔上限 10MB"
                >
                  <Input
                    name="file"
                    type="file"
                    required
                    accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,application/pdf,image/*"
                    className="file:mr-3 file:rounded-md file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm"
                  />
                </Field>
                <Field label="類型">
                  <Select name="kind" defaultValue="signed_quote">
                    {Object.entries(ATTACHMENT_KIND_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="回簽日" hint="客戶簽署的日期，與上傳日未必相同">
                  <Input name="signedOn" type="date" />
                </Field>
                <Field label="備註" className="sm:col-span-2">
                  <Textarea name="note" rows={2} />
                </Field>
                {quote.status !== 'accepted' && (
                  <div className="sm:col-span-2">
                    <Checkbox
                      name="markAccepted"
                      label="同時標記這張報價單為「客戶已同意」"
                      hint="收到回簽通常代表客戶同意了，但有時上傳的只是待確認的版本，所以由你決定"
                    />
                  </div>
                )}
              </div>
            </ActionForm>
          </Disclosure>
        </div>
      </Card>

      {!isClosed && (
        <Card title="操作">
          <div className="space-y-5 p-5">
            {canSend && recipients.length > 0 && (
              <Disclosure label="寄給客戶">
                <ActionForm
                  action={sendQuote}
                  submitLabel="確認寄出"
                  footer={
                    <span className="text-xs text-muted">
                      寄出後狀態會變成「已寄出」
                    </span>
                  }
                >
                  <input type="hidden" name="id" value={quote.id} />
                  <div className="rounded-lg border border-warning/30 bg-warning-bg p-4">
                    <p className="text-sm font-medium text-warning">
                      這封信會立即寄給：
                    </p>
                    <ul className="mt-2 space-y-1">
                      {recipients.map((email) => (
                        <li
                          key={email}
                          className="text-sm font-bold text-warning"
                        >
                          · {email}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-xs text-warning/80">
                      內容為簡短說明 + 報價單 PDF 附件，合計{' '}
                      {formatMoney(quote.total, quote.currency)}。
                      {!features.email &&
                        '（尚未設定 Resend，目前會寄送失敗）'}
                    </p>
                  </div>
                </ActionForm>
              </Disclosure>
            )}

            {quote.status === 'sent' && (
              <div className="flex flex-wrap gap-6">
                <ActionForm
                  action={markAccepted}
                  submitLabel="客戶已同意"
                  submitVariant="secondary"
                >
                  <input type="hidden" name="id" value={quote.id} />
                </ActionForm>
                <ActionForm
                  action={markRejected}
                  submitLabel="客戶不續約"
                  submitVariant="secondary"
                >
                  <input type="hidden" name="id" value={quote.id} />
                </ActionForm>
              </div>
            )}

            {(quote.status === 'sent' || quote.status === 'accepted') && (
              <div className="border-t border-border pt-5">
                <ActionForm action={markQuoteRenewed} submitLabel="標記已續約">
                  <input type="hidden" name="id" value={quote.id} />
                  <p className="text-sm text-muted">
                    客戶已付款後按這個。這張單涵蓋的{quote.items.length}
                    個項目會各自依自己的計費週期推進到期日，並重置續約狀態。
                  </p>
                </ActionForm>
              </div>
            )}

            <div className="border-t border-border pt-5">
              <ConfirmForm
                action={cancelQuoteAction}
                label="取消這張報價單"
                confirmLabel="確定取消"
                message="項目會放回待處理，下個週期會重新擬草稿。已寄出的信不會收回。"
              >
                <input type="hidden" name="id" value={quote.id} />
              </ConfirmForm>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
