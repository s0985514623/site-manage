import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'

import { ActionForm, ConfirmForm, Disclosure } from '@/components/action-form'
import {
  Badge,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Table,
  Td,
  Textarea,
  Th,
} from '@/components/ui'
import { db } from '@/db'
import { clients, contacts } from '@/db/schema'
import { daysUntil } from '@/lib/dates'
import { CONTACT_ROLE_LABEL, SITE_STATUS_LABEL } from '@/lib/labels'
import { DaysBadge } from '@/components/ui'
import {
  deleteClient,
  deleteContact,
  saveContact,
  updateClient,
} from '@/server/actions/clients'
import { createSite } from '@/server/actions/sites'
import { getClientDetail } from '@/server/queries'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: PageProps<'/clients/[id]'>) {
  const { id } = await params
  const client = await db.query.clients.findFirst({ where: eq(clients.id, id) })
  return { title: client?.name ?? '客戶' }
}

function ContactForm({
  clientId,
  contact,
}: {
  clientId: string
  contact?: typeof contacts.$inferSelect
}) {
  return (
    <ActionForm
      action={saveContact}
      submitLabel={contact ? '儲存' : '新增聯絡人'}
      resetOnSuccess={!contact}
    >
      <input type="hidden" name="clientId" value={clientId} />
      {contact && <input type="hidden" name="id" value={contact.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="姓名" required>
          <Input name="name" required defaultValue={contact?.name} />
        </Field>
        <Field label="角色">
          <Select name="role" defaultValue={contact?.role ?? 'other'}>
            {Object.entries(CONTACT_ROLE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Email">
          <Input
            name="email"
            type="email"
            defaultValue={contact?.email ?? ''}
          />
        </Field>
        <Field label="電話">
          <Input name="phone" defaultValue={contact?.phone ?? ''} />
        </Field>
        <div className="space-y-3 sm:col-span-2">
          <Checkbox
            name="isPrimary"
            label="設為主要聯絡人"
            defaultChecked={contact?.isPrimary}
            hint="一個客戶只會有一位，勾選後會自動取消其他人的主要標記"
          />
          <Checkbox
            name="receiveQuotes"
            label="接收報價單"
            defaultChecked={contact?.receiveQuotes}
            hint="續約報價單會寄到這位窗口的 Email。可勾選多位，寄出前會在 LINE 上列出讓你核對"
          />
        </div>
      </div>
    </ActionForm>
  )
}

export default async function ClientDetailPage({
  params,
}: PageProps<'/clients/[id]'>) {
  const { id } = await params
  const data = await getClientDetail(id)
  if (!data) notFound()

  const { client, contacts: clientContacts, sites: clientSites } = data
  const quoteRecipients = clientContacts.filter(
    (c) => c.receiveQuotes && c.email,
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title={client.name}
        back={{ href: '/clients', label: '客戶列表' }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {client.taxId && <span className="tabular">統編 {client.taxId}</span>}
            {client.status === 'inactive' && <Badge>已停用</Badge>}
          </span>
        }
      />

      {quoteRecipients.length === 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning-bg px-5 py-4 text-sm text-warning">
          尚未設定報價單收件人。續約報價單需要至少一位勾選「接收報價單」且有
          Email 的聯絡人，否則系統無法寄出。
        </div>
      )}

      <Card
        title="網站"
        description="報價單以「網站」為單位合併：同一網站的網域、主機等項目會合成一張單"
      >
        {clientSites.length === 0 ? (
          <EmptyState
            title="還沒有網站"
            description="建立網站後，才能登記它的網域、主機、SSL 與維護合約。"
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>網站</Th>
                <Th>狀態</Th>
                <Th align="right">服務項目</Th>
                <Th>最近到期</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {clientSites.map((site) => {
                const next = site.services[0]
                return (
                  <tr key={site.id} className="hover:bg-surface-muted">
                    <Td>
                      <Link
                        href={`/sites/${site.id}`}
                        className="font-medium hover:text-accent"
                      >
                        {site.name}
                      </Link>
                      {site.primaryUrl && (
                        <div className="mt-0.5 truncate text-xs text-muted">
                          {site.primaryUrl}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <Badge
                        tone={site.status === 'live' ? 'safe' : 'neutral'}
                      >
                        {SITE_STATUS_LABEL[site.status]}
                      </Badge>
                    </Td>
                    <Td align="right" className="tabular">
                      {site.services.length}
                    </Td>
                    <Td>
                      {next ? (
                        <DaysBadge days={daysUntil(next.expiresAt)} />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                    <Td align="right">
                      <Link
                        href={`/sites/${site.id}`}
                        className="text-sm text-accent hover:underline"
                      >
                        查看
                      </Link>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}

        <div className="border-t border-border p-5">
          <Disclosure label="新增網站">
            <ActionForm action={createSite} submitLabel="建立網站">
              <input type="hidden" name="clientId" value={client.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="網站名稱" required>
                  <Input name="name" required placeholder="例：官方網站" />
                </Field>
                <Field label="網址">
                  <Input
                    name="primaryUrl"
                    type="url"
                    placeholder="https://example.com"
                  />
                </Field>
                <Field label="CMS / 平台">
                  <Input name="cmsType" placeholder="WordPress" />
                </Field>
                <Field label="狀態">
                  <Select name="status" defaultValue="live">
                    {Object.entries(SITE_STATUS_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="DNS 筆記"
                  className="sm:col-span-2"
                  hint="A 記錄指向哪台主機、MX 指向哪個信箱服務、是否走 Cloudflare。換主機時會很有用"
                >
                  <Textarea name="dnsNote" />
                </Field>
                <Field label="備註" className="sm:col-span-2">
                  <Textarea name="note" />
                </Field>
              </div>
            </ActionForm>
          </Disclosure>
        </div>
      </Card>

      <Card
        title="聯絡人"
        description="決策者、財務、技術窗口常常不是同一個人"
      >
        {clientContacts.length === 0 ? (
          <EmptyState title="還沒有聯絡人" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>姓名</Th>
                <Th>角色</Th>
                <Th>Email</Th>
                <Th>電話</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {clientContacts.map((contact) => (
                <tr key={contact.id} className="align-top">
                  <Td>
                    <span className="font-medium">{contact.name}</span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {contact.isPrimary && <Badge tone="accent">主要</Badge>}
                      {contact.receiveQuotes && (
                        <Badge tone="safe">收報價單</Badge>
                      )}
                    </div>
                  </Td>
                  <Td className="text-muted">
                    {CONTACT_ROLE_LABEL[contact.role]}
                  </Td>
                  <Td className="text-muted">{contact.email ?? '—'}</Td>
                  <Td className="text-muted">{contact.phone ?? '—'}</Td>
                  <Td align="right">
                    <details>
                      <summary className="cursor-pointer list-none text-sm text-accent hover:underline">
                        編輯
                      </summary>
                      <div className="mt-4 w-80 max-w-full rounded-lg border border-border bg-surface-muted p-4 text-left">
                        <ContactForm
                          clientId={client.id}
                          contact={contact}
                        />
                        <div className="mt-4 border-t border-border pt-4">
                          <ConfirmForm
                            action={deleteContact}
                            label="刪除這位聯絡人"
                            confirmLabel="確定刪除"
                            message="刪除後無法復原。"
                          >
                            <input
                              type="hidden"
                              name="id"
                              value={contact.id}
                            />
                            <input
                              type="hidden"
                              name="clientId"
                              value={client.id}
                            />
                          </ConfirmForm>
                        </div>
                      </div>
                    </details>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        <div className="border-t border-border p-5">
          <Disclosure label="新增聯絡人">
            <ContactForm clientId={client.id} />
          </Disclosure>
        </div>
      </Card>

      <Card title="客戶資料">
        <div className="p-5">
          <ActionForm action={updateClient} submitLabel="儲存">
            <input type="hidden" name="id" value={client.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="客戶全名" required className="sm:col-span-2">
                <Input name="name" required defaultValue={client.name} />
              </Field>
              <Field
                label="簡稱"
                hint="報價單「專案名稱」用。留空則用全名"
              >
                <Input name="shortName" defaultValue={client.shortName ?? ''} />
              </Field>
              <Field label="統一編號">
                <Input
                  name="taxId"
                  inputMode="numeric"
                  defaultValue={client.taxId ?? ''}
                />
              </Field>
              <Field label="負責人" hint="報價單甲乙方對照區需要">
                <Input
                  name="representative"
                  defaultValue={client.representative ?? ''}
                />
              </Field>
              <Field label="電話">
                <Input name="phone" defaultValue={client.phone ?? ''} />
              </Field>
              <Field label="地址" className="sm:col-span-2">
                <Input name="address" defaultValue={client.address ?? ''} />
              </Field>
              <Field label="備註" className="sm:col-span-2">
                <Textarea name="note" defaultValue={client.note ?? ''} />
              </Field>
              <div className="sm:col-span-2">
                <Checkbox
                  name="inactive"
                  label="停用這個客戶"
                  defaultChecked={client.status === 'inactive'}
                  hint="停用後仍保留所有歷史資料，只是不再出現在日常清單中"
                />
              </div>
            </div>
          </ActionForm>

          <div className="mt-6 border-t border-border pt-6">
            <ConfirmForm
              action={deleteClient}
              label="刪除這個客戶"
              confirmLabel="確定刪除"
              message="會一併刪除底下所有網站與服務項目，無法復原。若已有報價單紀錄則無法刪除。"
            >
              <input type="hidden" name="id" value={client.id} />
            </ConfirmForm>
          </div>
        </div>
      </Card>
    </div>
  )
}
