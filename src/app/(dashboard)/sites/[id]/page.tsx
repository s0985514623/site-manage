import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'

import { ActionForm, ConfirmForm, Disclosure } from '@/components/action-form'
import {
  Badge,
  Card,
  Checkbox,
  DaysBadge,
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
import { plans, services, sites, type Plan } from '@/db/schema'
import { CYCLE_LABEL, advanceByCycle, daysUntil, formatTw, type BillingCycle } from '@/lib/dates'
import {
  RENEWAL_STATE_LABEL,
  SERVICE_TYPE_ICON,
  SERVICE_TYPE_LABEL,
  SITE_STATUS_LABEL,
} from '@/lib/labels'
import { formatMoney } from '@/lib/money'
import {
  acceptDetectedDate,
  deleteService,
  markRenewed,
  saveService,
} from '@/server/actions/services'
import { deleteSite, updateSite } from '@/server/actions/sites'
import {
  deleteCredential,
  saveCredential,
} from '@/server/actions/credentials'
import { CredentialReveal } from '@/components/credential-reveal'
import { RenewalQuoteButton } from '@/components/renewal-quote-button'
import { getSiteDetail } from '@/server/queries'
import { asc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: PageProps<'/sites/[id]'>) {
  const { id } = await params
  const site = await db.query.sites.findFirst({ where: eq(sites.id, id) })
  return { title: site?.name ?? '網站' }
}

function ServiceForm({
  siteId,
  service,
  planOptions,
}: {
  siteId: string
  service?: typeof services.$inferSelect
  planOptions: Plan[]
}) {
  return (
    <ActionForm
      action={saveService}
      submitLabel={service ? '儲存' : '新增服務項目'}
      resetOnSuccess={!service}
    >
      <input type="hidden" name="siteId" value={siteId} />
      {service && <input type="hidden" name="id" value={service.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="類型" required>
          <Select name="type" defaultValue={service?.type ?? 'domain'}>
            {Object.entries(SERVICE_TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="項目名稱" required hint="網域名稱 / 主機方案 / 外掛名">
          <Input
            name="identifier"
            required
            defaultValue={service?.identifier}
            placeholder="example.com"
          />
        </Field>

        <Field label="供應商">
          <Input
            name="provider"
            defaultValue={service?.provider ?? ''}
            placeholder="Gandi / Cloudflare / 中華電信"
          />
        </Field>
        <Field label="註冊商帳號" hint="這個項目掛在誰的帳號下">
          <Input
            name="providerAccount"
            defaultValue={service?.providerAccount ?? ''}
          />
        </Field>

        <Field label="開始日">
          <Input
            name="startedAt"
            type="date"
            defaultValue={service?.startedAt ?? ''}
          />
        </Field>
        <Field label="到期日" required>
          <Input
            name="expiresAt"
            type="date"
            required
            defaultValue={service?.expiresAt}
          />
        </Field>

        <Field label="計費週期" required>
          <Select
            name="billingCycle"
            defaultValue={service?.billingCycle ?? 'yearly'}
          >
            {Object.entries(CYCLE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="幣別">
          <Select name="currency" defaultValue={service?.currency ?? 'TWD'}>
            <option value="TWD">TWD 新台幣</option>
            <option value="USD">USD 美金</option>
            <option value="EUR">EUR 歐元</option>
          </Select>
        </Field>

        {(!service || service.type === 'domain' || service.type === 'ssl') && (
          <Field
            label="偵測目標"
            className="sm:col-span-2"
            hint="要查 WHOIS／SSL 的網域或網址。留空時，若上面的「項目名稱」本身就是網域就直接用它"
          >
            <Input
              name="detectHost"
              defaultValue={service?.detectHost ?? ''}
              placeholder="example.com.tw"
            />
          </Field>
        )}

        <Field
          label="方案範本"
          className="sm:col-span-2"
          hint="選了之後，報價單的「概要／功能說明」會自動帶入該方案的規格"
        >
          <Select name="planId" defaultValue={service?.planId ?? ''}>
            <option value="">不使用範本</option>
            {planOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.priceAmount ? `（${formatMoney(p.priceAmount)}）` : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="自訂規格說明"
          className="sm:col-span-2"
          hint="填了會蓋過方案範本的內容。留空則使用方案範本，兩者皆無則只印服務期間"
        >
          <Textarea name="specNote" rows={5} defaultValue={service?.specNote ?? ''} />
        </Field>

        <Field label="成本價" hint="你付給供應商的金額">
          <Input
            name="costAmount"
            type="number"
            min="0"
            step="0.01"
            defaultValue={service?.costAmount ?? ''}
          />
        </Field>
        <Field label="售價" hint="跟客戶收的金額，會直接帶入報價單">
          <Input
            name="priceAmount"
            type="number"
            min="0"
            step="0.01"
            defaultValue={service?.priceAmount ?? ''}
          />
        </Field>

        {service?.type === 'domain' || !service ? (
          <Field
            label="EPP / Auth Code"
            className="sm:col-span-2"
            hint={
              service?.authCodeEncrypted
                ? '已儲存（加密）。留空表示不變更，填入新值則覆蓋'
                : '網域轉移必備。會加密後儲存'
            }
          >
            <Input
              name="authCode"
              type="password"
              autoComplete="off"
              placeholder={service?.authCodeEncrypted ? '••••••••' : ''}
            />
          </Field>
        ) : null}

        <div className="space-y-3 sm:col-span-2">
          <Checkbox
            name="isOurs"
            label="由我方代管代購"
            defaultChecked={service ? service.isOurs : true}
            hint="取消勾選代表客戶自己購買。系統一樣會提醒到期，但絕不會開進報價單，避免重複收費"
          />
          <Checkbox
            name="autoRenew"
            label="供應商已設定自動續約"
            defaultChecked={service?.autoRenew}
            hint="僅作為備註。自動續約也可能因信用卡過期而失敗，所以到期提醒照常發送"
          />
        </div>

        <Field label="備註" className="sm:col-span-2">
          <Textarea name="note" defaultValue={service?.note ?? ''} />
        </Field>
      </div>
    </ActionForm>
  )
}


function CredentialForm({
  serviceId,
  siteId,
  credential,
}: {
  serviceId: string
  siteId: string
  credential?: {
    id: string
    label: string
    url: string | null
    username: string | null
    note: string | null
  }
}) {
  return (
    <ActionForm
      action={saveCredential}
      submitLabel={credential ? '儲存' : '新增憑證'}
      resetOnSuccess={!credential}
    >
      <input type="hidden" name="serviceId" value={serviceId} />
      <input type="hidden" name="siteId" value={siteId} />
      {credential && <input type="hidden" name="id" value={credential.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="用途" required hint="例：WP 後台、FTP、cPanel">
          <Input name="label" required defaultValue={credential?.label} />
        </Field>
        <Field label="登入網址">
          <Input
            name="url"
            type="url"
            defaultValue={credential?.url ?? ''}
            placeholder="https://example.com/wp-admin"
          />
        </Field>
        <Field label="帳號">
          <Input
            name="username"
            autoComplete="off"
            defaultValue={credential?.username ?? ''}
          />
        </Field>
        <Field
          label="密碼"
          required={!credential}
          hint={credential ? '留空表示不變更' : '會加密後儲存'}
        >
          <Input
            name="secret"
            type="password"
            autoComplete="new-password"
            required={!credential}
            placeholder={credential ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : ''}
          />
        </Field>
        <Field label="備註" className="sm:col-span-2">
          <Textarea name="note" rows={2} defaultValue={credential?.note ?? ''} />
        </Field>
      </div>
    </ActionForm>
  )
}

export default async function SiteDetailPage({
  params,
}: PageProps<'/sites/[id]'>) {
  const { id } = await params
  const [site, planOptions] = await Promise.all([
    getSiteDetail(id),
    db.query.plans.findMany({
      where: eq(plans.active, true),
      orderBy: [asc(plans.sortOrder), asc(plans.name)],
    }),
  ])
  if (!site) notFound()

  const billable = site.services.filter(
    (s) => s.isOurs && s.status === 'active',
  )
  const missingPrice = billable.filter((s) => !s.priceAmount)
  // 還沒被任何報價單涵蓋、可以開進續約報價的項目（依到期日排序，第一筆為錨點）
  const quotable = billable
    .filter((s) => s.renewalState === 'upcoming' && !s.currentQuoteId && s.priceAmount)
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
  const renewalAnchor = quotable[0]

  return (
    <div className="space-y-6">
      <PageHeader
        title={site.name}
        back={{ href: `/clients/${site.clientId}`, label: site.client.name }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={site.status === 'live' ? 'safe' : 'neutral'}>
              {SITE_STATUS_LABEL[site.status]}
            </Badge>
            {site.primaryUrl && (
              <a
                href={site.primaryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent hover:underline"
              >
                {site.primaryUrl}
              </a>
            )}
            {site.cmsType && <span>{site.cmsType}</span>}
          </span>
        }
      />

      {missingPrice.length > 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning-bg px-5 py-4 text-sm text-warning">
          有 {missingPrice.length} 個代管項目沒有填售價
          （{missingPrice.map((s) => s.identifier).join('、')}）。
          未填售價的項目會被排除在自動報價單之外，避免寄出金額為零的報價。
        </div>
      )}

      <Card
        title="服務項目"
        description={
          renewalAnchor
            ? `最早可續約：${renewalAnchor.identifier}（${formatTw(renewalAnchor.expiresAt)} 到期）。開立時會把之後一段期間內到期的項目合併成一張`
            : '每一個會到期的東西都是獨立一筆：網域、主機、SSL、維護合約各自有到期日與價格'
        }
        action={renewalAnchor ? <RenewalQuoteButton siteId={site.id} /> : undefined}
      >
        {site.services.length === 0 ? (
          <EmptyState
            title="還沒有服務項目"
            description="把這個網站的網域、主機、維護合約分別登記進來，系統才能追蹤到期日並產生合併報價單。"
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>項目</Th>
                <Th>供應商</Th>
                <Th>到期日</Th>
                <Th>倒數</Th>
                <Th align="right">售價</Th>
                <Th>續約狀態</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {site.services.map((service) => {
                const days = daysUntil(service.expiresAt)
                const conflict =
                  service.detectedExpiresAt &&
                  service.detectedExpiresAt !== service.expiresAt
                return (
                  <tr key={service.id} className="align-top hover:bg-surface-muted">
                    <Td>
                      <span className="font-medium">
                        <span aria-hidden className="mr-1.5">
                          {SERVICE_TYPE_ICON[service.type]}
                        </span>
                        {service.identifier}
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge>{SERVICE_TYPE_LABEL[service.type]}</Badge>
                        {!service.isOurs && <Badge tone="warning">客戶自管</Badge>}
                        {service.autoRenew && <Badge>自動續約</Badge>}
                      </div>
                    </Td>
                    <Td className="text-muted">{service.provider ?? '—'}</Td>
                    <Td className="tabular">
                      {formatTw(service.expiresAt)}
                      <div className="mt-0.5 text-xs text-muted">
                        {CYCLE_LABEL[service.billingCycle as BillingCycle]}
                      </div>
                      {conflict && (
                        <div className="mt-1.5">
                          <Badge tone="warning">
                            偵測到 {formatTw(service.detectedExpiresAt!)}
                          </Badge>
                        </div>
                      )}
                    </Td>
                    <Td>
                      <DaysBadge days={days} />
                    </Td>
                    <Td align="right" className="tabular">
                      {service.isOurs
                        ? service.priceAmount
                          ? formatMoney(service.priceAmount, service.currency)
                          : '未設定'
                        : '—'}
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          service.renewalState === 'pending_approval'
                            ? 'warning'
                            : service.renewalState === 'renewed'
                              ? 'safe'
                              : 'neutral'
                        }
                      >
                        {RENEWAL_STATE_LABEL[service.renewalState]}
                      </Badge>
                    </Td>
                    <Td align="right">
                      <details>
                        <summary className="cursor-pointer list-none text-sm text-accent hover:underline">
                          編輯
                        </summary>
                        <div className="mt-4 w-[32rem] max-w-full rounded-lg border border-border bg-surface-muted p-4 text-left">
                          <ServiceForm
                            siteId={site.id}
                            service={service}
                            planOptions={planOptions}
                          />

                          <div className="mt-5 space-y-4 border-t border-border pt-5">
                            {conflict && (
                              <ActionForm
                                action={acceptDetectedDate}
                                submitLabel={`採用偵測到的 ${formatTw(service.detectedExpiresAt!)}`}
                                submitVariant="secondary"
                              >
                                <input type="hidden" name="id" value={service.id} />
                                <input type="hidden" name="siteId" value={site.id} />
                                <p className="text-sm text-muted">
                                  {service.detectSource === 'whois'
                                    ? 'WHOIS'
                                    : 'SSL 憑證'}
                                  查到的到期日與目前登記的不一致。確認無誤後再套用。
                                </p>
                              </ActionForm>
                            )}

                            <ActionForm
                              action={markRenewed}
                              submitLabel="標記為已續約"
                              submitVariant="secondary"
                            >
                              <input type="hidden" name="id" value={service.id} />
                              <input type="hidden" name="siteId" value={site.id} />
                              <p className="text-sm text-muted">
                                到期日會依計費週期推進到{' '}
                                <span className="tabular font-medium text-foreground">
                                  {formatTw(
                                    advanceByCycle(
                                      service.expiresAt,
                                      service.billingCycle as BillingCycle,
                                    ),
                                  )}
                                </span>
                                ，續約狀態重置。
                              </p>
                            </ActionForm>

                            <div className="space-y-4 border-t border-border pt-5">
                              <div>
                                <h4 className="text-sm font-bold">登入憑證</h4>
                                <p className="mt-0.5 text-xs text-muted">
                                  密碼以 AES-256-GCM 加密儲存，明文不進資料庫。
                                  每次顯示都會寫入稽核紀錄
                                </p>
                              </div>

                              {service.credentials.length > 0 && (
                                <ul className="space-y-3">
                                  {service.credentials.map((cred) => (
                                    <li
                                      key={cred.id}
                                      className="rounded-lg border border-border bg-surface p-3"
                                    >
                                      <div className="flex flex-wrap items-baseline gap-2">
                                        <span className="text-sm font-medium">
                                          {cred.label}
                                        </span>
                                        {cred.username && (
                                          <span className="text-xs text-muted">
                                            {cred.username}
                                          </span>
                                        )}
                                      </div>
                                      {cred.url && (
                                        <a
                                          href={cred.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="mt-0.5 block truncate text-xs text-accent hover:underline"
                                        >
                                          {cred.url}
                                        </a>
                                      )}
                                      <div className="mt-2">
                                        <CredentialReveal id={cred.id} />
                                      </div>
                                      {cred.note && (
                                        <p className="mt-2 text-xs text-muted">
                                          {cred.note}
                                        </p>
                                      )}
                                      <div className="mt-3 border-t border-border pt-3">
                                        <details>
                                          <summary className="cursor-pointer list-none text-xs text-accent hover:underline">
                                            編輯 / 刪除
                                          </summary>
                                          <div className="mt-3 space-y-4">
                                            <CredentialForm
                                              serviceId={service.id}
                                              siteId={site.id}
                                              credential={cred}
                                            />
                                            <ConfirmForm
                                              action={deleteCredential}
                                              label="刪除這筆憑證"
                                              confirmLabel="確定刪除"
                                              message="刪除後無法復原。"
                                            >
                                              <input
                                                type="hidden"
                                                name="id"
                                                value={cred.id}
                                              />
                                              <input
                                                type="hidden"
                                                name="siteId"
                                                value={site.id}
                                              />
                                            </ConfirmForm>
                                          </div>
                                        </details>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              )}

                              <Disclosure label="新增憑證">
                                <CredentialForm
                                  serviceId={service.id}
                                  siteId={site.id}
                                />
                              </Disclosure>
                            </div>

                            <ConfirmForm
                              action={deleteService}
                              label="刪除這個項目"
                              confirmLabel="確定刪除"
                              message="刪除後無法復原，包含底下的登入憑證。"
                            >
                              <input type="hidden" name="id" value={service.id} />
                              <input type="hidden" name="siteId" value={site.id} />
                            </ConfirmForm>
                          </div>
                        </div>
                      </details>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}

        <div className="border-t border-border p-5">
          <Disclosure label="新增服務項目">
            <ServiceForm siteId={site.id} planOptions={planOptions} />
          </Disclosure>
        </div>
      </Card>

      {site.dnsNote && (
        <Card title="DNS 筆記">
          <pre className="whitespace-pre-wrap px-5 py-4 text-sm text-muted">
            {site.dnsNote}
          </pre>
        </Card>
      )}

      <Card title="網站資料">
        <div className="p-5">
          <ActionForm action={updateSite} submitLabel="儲存">
            <input type="hidden" name="id" value={site.id} />
            <input type="hidden" name="clientId" value={site.clientId} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="網站名稱" required>
                <Input name="name" required defaultValue={site.name} />
              </Field>
              <Field label="網址">
                <Input
                  name="primaryUrl"
                  type="url"
                  defaultValue={site.primaryUrl ?? ''}
                />
              </Field>
              <Field label="CMS / 平台">
                <Input name="cmsType" defaultValue={site.cmsType ?? ''} />
              </Field>
              <Field label="狀態">
                <Select name="status" defaultValue={site.status}>
                  {Object.entries(SITE_STATUS_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="DNS 筆記" className="sm:col-span-2">
                <Textarea name="dnsNote" defaultValue={site.dnsNote ?? ''} />
              </Field>
              <Field label="備註" className="sm:col-span-2">
                <Textarea name="note" defaultValue={site.note ?? ''} />
              </Field>
              <div className="sm:col-span-2">
                <Checkbox
                  name="monitorEnabled"
                  label="啟用存活監控"
                  defaultChecked={site.monitorEnabled}
                  hint="每小時檢查一次，連續兩次失敗才告警，避免瞬斷誤報"
                />
              </div>
            </div>
          </ActionForm>

          <div className="mt-6 border-t border-border pt-6">
            <ConfirmForm
              action={deleteSite}
              label="刪除這個網站"
              confirmLabel="確定刪除"
              message="會一併刪除底下所有服務項目與登入憑證，無法復原。"
            >
              <input type="hidden" name="id" value={site.id} />
              <input type="hidden" name="clientId" value={site.clientId} />
            </ConfirmForm>
          </div>
        </div>
      </Card>

      <p className="text-center text-xs text-muted">
        <Link href="/services" className="hover:text-foreground hover:underline">
          查看所有網站的到期總表 →
        </Link>
      </p>
    </div>
  )
}
