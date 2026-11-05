import { asc } from 'drizzle-orm'

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
import { plans, type Plan } from '@/db/schema'
import { CYCLE_LABEL } from '@/lib/dates'
import { features } from '@/lib/env'
import { SERVICE_TYPE_LABEL } from '@/lib/labels'
import { TAX_MODE_LABEL, formatMoney } from '@/lib/money'
import { calendarStatus } from '@/lib/gcal'
import { getSettings } from '@/lib/settings'
import { deletePlan, savePlan } from '@/server/actions/plans'
import { saveSettings } from '@/server/actions/settings'

export const metadata = { title: '設定' }
export const dynamic = 'force-dynamic'

function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-2 rounded-full ${on ? 'bg-safe' : 'bg-muted'}`}
    />
  )
}

function PlanForm({ plan }: { plan?: Plan }) {
  return (
    <ActionForm
      action={savePlan}
      submitLabel={plan ? '儲存' : '新增方案'}
      resetOnSuccess={!plan}
    >
      {plan && <input type="hidden" name="id" value={plan.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="方案名稱" required>
          <Input name="name" required defaultValue={plan?.name} />
        </Field>
        <Field label="適用類型">
          <Select name="type" defaultValue={plan?.type ?? 'hosting'}>
            {Object.entries(SERVICE_TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="規格說明"
          required
          className="sm:col-span-2"
          hint="這段文字會原樣印在報價單的「概要／功能說明」欄，一行一項"
        >
          <Textarea name="specNote" rows={6} required defaultValue={plan?.specNote} />
        </Field>
        <Field label="預設售價" hint="建立服務項目時帶入，之後仍可個別調整">
          <Input
            name="priceAmount"
            type="number"
            min="0"
            step="0.01"
            defaultValue={plan?.priceAmount ?? ''}
          />
        </Field>
        <Field label="計費週期">
          <Select name="billingCycle" defaultValue={plan?.billingCycle ?? 'yearly'}>
            {Object.entries(CYCLE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="內部備註" hint="只有你看得到，不會出現在報價單上">
          <Input name="note" defaultValue={plan?.note ?? ''} />
        </Field>
        <Field label="排序" hint="數字小的排前面">
          <Input
            name="sortOrder"
            type="number"
            defaultValue={plan?.sortOrder ?? 0}
          />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox
            name="inactive"
            label="停用這個方案"
            defaultChecked={plan ? !plan.active : false}
            hint="停用後不會出現在新增服務項目的選單，但既有項目的規格說明保留"
          />
        </div>
      </div>
    </ActionForm>
  )
}

const GCAL_MESSAGE: Record<string, { tone: 'ok' | 'error'; text: string }> = {
  ok: { tone: 'ok', text: 'Google Calendar 授權完成，專屬日曆已建立。' },
  denied: { tone: 'error', text: '授權未完成。' },
  error: { tone: 'error', text: '授權失敗。' },
}

export default async function SettingsPage({
  searchParams,
}: PageProps<'/settings'>) {
  const params = await searchParams
  const gcalResult =
    typeof params.gcal === 'string' ? GCAL_MESSAGE[params.gcal] : undefined
  const gcalDetail =
    typeof params.detail === 'string' ? params.detail : undefined

  const [config, planRows, gcal] = await Promise.all([
    getSettings(),
    db.query.plans.findMany({ orderBy: [asc(plans.sortOrder), asc(plans.name)] }),
    calendarStatus(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="設定"
        description="公司抬頭與匯款帳號會印在報價單上；觸發天數決定系統什麼時候把報價草稿推到 LINE"
      />

      <Card title="報價流程">
        <div className="p-5">
          <ActionForm action={saveSettings} submitLabel="儲存設定">
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field
                  label="觸發天數"
                  required
                  hint="網站最早到期的項目剩下這麼多天時，開始擬報價草稿"
                >
                  <Input
                    name="quoteTriggerDays"
                    type="number"
                    min="1"
                    max="365"
                    required
                    defaultValue={config.quoteTriggerDays}
                  />
                </Field>
                <Field
                  label="合併窗口天數"
                  required
                  hint="把最早到期日往後這麼多天內到期的項目，一併開進同一張報價單"
                >
                  <Input
                    name="quoteWindowDays"
                    type="number"
                    min="0"
                    max="365"
                    required
                    defaultValue={config.quoteWindowDays}
                  />
                </Field>
                <Field
                  label="報價有效天數"
                  required
                  hint="不可大於觸發天數，否則客戶可能在項目到期後才回覆"
                >
                  <Input
                    name="quoteValidDays"
                    type="number"
                    min="1"
                    max="180"
                    required
                    defaultValue={config.quoteValidDays}
                  />
                </Field>
              </div>

              <div className="rounded-lg border border-border bg-surface-muted p-4 text-sm text-muted">
                <p className="font-medium text-foreground">目前設定的意思</p>
                <p className="mt-1.5">
                  當某個網站最早到期的項目剩下{' '}
                  <strong className="tabular text-foreground">
                    {config.quoteTriggerDays}
                  </strong>{' '}
                  天時，系統會把該網站在那之後{' '}
                  <strong className="tabular text-foreground">
                    {config.quoteWindowDays}
                  </strong>{' '}
                  天內到期的項目全部合併成一張報價單，推到 LINE 給你確認。
                </p>
                <p className="mt-2">
                  各項服務期間一律自
                  <strong className="text-foreground">該項目原到期日的隔天</strong>
                  起算。例如網域 10/15 到期、主機 12/01 到期，合併收款後主機的
                  期間仍是 12/02 起算，客戶不會少拿到服務。
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="預設稅別">
                  <Select
                    name="defaultTaxMode"
                    defaultValue={config.defaultTaxMode}
                  >
                    {Object.entries(TAX_MODE_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="稅率" hint="台灣營業稅為 0.05">
                  <Input
                    name="defaultTaxRate"
                    type="number"
                    min="0"
                    max="1"
                    step="0.0001"
                    defaultValue={config.defaultTaxRate}
                  />
                </Field>
              </div>

              <Field
                label="匯款期限警語"
                hint="印在報價單「交付方式」欄。{date} 會替換成該網站最早到期的日期"
              >
                <Input
                  name="quotePaymentNote"
                  defaultValue={config.quotePaymentNote ?? ''}
                />
              </Field>

              <Field
                label="報價單備註條款"
                hint="印在報價單最下方，會寄給客戶，請留意用字"
              >
                <Textarea
                  name="quoteTerms"
                  rows={8}
                  defaultValue={config.quoteTerms ?? ''}
                />
              </Field>
            </div>

            <div className="mt-8 border-t border-border pt-6">
              <h3 className="mb-1 text-sm font-bold">公司抬頭（乙方）</h3>
              <p className="mb-4 text-xs text-muted">
                印在報價單右上角與下方的甲乙方對照區
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="公司名稱">
                  <Input name="companyName" defaultValue={config.companyName ?? ''} />
                </Field>
                <Field label="統一編號">
                  <Input
                    name="companyTaxId"
                    inputMode="numeric"
                    defaultValue={config.companyTaxId ?? ''}
                  />
                </Field>
                <Field label="負責人">
                  <Input
                    name="companyRepresentative"
                    defaultValue={config.companyRepresentative ?? ''}
                  />
                </Field>
                <Field label="製表人" hint="報價單上的承辦人姓名">
                  <Input name="preparedBy" defaultValue={config.preparedBy ?? ''} />
                </Field>
                <Field label="聯絡電話">
                  <Input
                    name="companyPhone"
                    defaultValue={config.companyPhone ?? ''}
                  />
                </Field>
                <Field label="聯絡 Email">
                  <Input
                    name="companyEmail"
                    type="email"
                    defaultValue={config.companyEmail ?? ''}
                  />
                </Field>
                <Field label="LINE ID">
                  <Input
                    name="companyLineId"
                    defaultValue={config.companyLineId ?? ''}
                  />
                </Field>
                <Field label="地址">
                  <Input
                    name="companyAddress"
                    defaultValue={config.companyAddress ?? ''}
                  />
                </Field>
              </div>
            </div>

            <div className="mt-8 border-t border-border pt-6">
              <h3 className="mb-1 text-sm font-bold">匯款帳號</h3>
              <p className="mb-4 text-xs text-muted">
                印在報價單的「付款方式」欄
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="銀行">
                  <Input
                    name="bankName"
                    placeholder="彰化銀行 大里分行"
                    defaultValue={config.bankName ?? ''}
                  />
                </Field>
                <Field label="銀行代號">
                  <Input
                    name="bankCode"
                    inputMode="numeric"
                    placeholder="009"
                    defaultValue={config.bankCode ?? ''}
                  />
                </Field>
                <Field label="帳號">
                  <Input
                    name="bankAccount"
                    defaultValue={config.bankAccount ?? ''}
                  />
                </Field>
                <Field label="戶名">
                  <Input
                    name="bankAccountName"
                    defaultValue={config.bankAccountName ?? ''}
                  />
                </Field>
              </div>
            </div>
          </ActionForm>
        </div>
      </Card>

      <Card
        title="方案範本"
        description="服務項目選用方案後，規格說明會自動帶進每年的報價單，不必重打"
      >
        {planRows.length === 0 ? (
          <EmptyState title="還沒有方案範本" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>方案</Th>
                <Th>類型</Th>
                <Th align="right">預設售價</Th>
                <Th>週期</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {planRows.map((plan) => (
                <tr key={plan.id} className="align-top hover:bg-surface-muted">
                  <Td>
                    <span className="font-medium">{plan.name}</span>
                    {!plan.active && (
                      <span className="ml-2">
                        <Badge>已停用</Badge>
                      </span>
                    )}
                    {plan.note && (
                      <div className="mt-0.5 text-xs text-muted">{plan.note}</div>
                    )}
                  </Td>
                  <Td className="text-muted">{SERVICE_TYPE_LABEL[plan.type]}</Td>
                  <Td align="right" className="tabular">
                    {plan.priceAmount ? formatMoney(plan.priceAmount) : '—'}
                  </Td>
                  <Td className="text-muted">{CYCLE_LABEL[plan.billingCycle]}</Td>
                  <Td align="right">
                    <details>
                      <summary className="cursor-pointer list-none text-sm text-accent hover:underline">
                        編輯
                      </summary>
                      <div className="mt-4 w-[32rem] max-w-full rounded-lg border border-border bg-surface-muted p-4 text-left">
                        <PlanForm plan={plan} />
                        <div className="mt-5 border-t border-border pt-5">
                          <ConfirmForm
                            action={deletePlan}
                            label="刪除這個方案"
                            confirmLabel="確定刪除"
                            message="已被服務項目使用的方案無法刪除，請改用停用。"
                          >
                            <input type="hidden" name="id" value={plan.id} />
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
          <Disclosure label="新增方案">
            <PlanForm />
          </Disclosure>
        </div>
      </Card>

      <Card
        title="Google Calendar"
        description="把所有到期日同步成一個專屬日曆，手機的行事曆 App 也看得到"
      >
        <div className="space-y-4 p-5">
          {gcalResult && (
            <p
              className={`rounded-lg border px-3 py-2 text-sm ${
                gcalResult.tone === 'ok'
                  ? 'border-safe/30 bg-safe-bg text-safe'
                  : 'border-overdue/30 bg-overdue-bg text-overdue'
              }`}
            >
              {gcalResult.text}
              {gcalDetail && (
                <span className="mt-1 block text-xs opacity-80">
                  {gcalDetail}
                </span>
              )}
            </p>
          )}

          {gcal.lastError && (
            <p className="rounded-lg border border-overdue/30 bg-overdue-bg px-3 py-2 text-sm text-overdue">
              <strong className="font-bold">同步已停止。</strong>{' '}
              {gcal.lastError}
            </p>
          )}

          {gcal.authorized ? (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="safe">已授權</Badge>
                <span className="text-muted">{gcal.accountEmail}</span>
              </div>
              {gcal.lastRefreshedAt && (
                <p className="text-xs text-muted">
                  最近一次換取權杖：
                  <span className="tabular">
                    {gcal.lastRefreshedAt.toLocaleString('zh-TW', {
                      timeZone: 'Asia/Taipei',
                    })}
                  </span>
                </p>
              )}
              <LinkButton
                href="/api/google/calendar/authorize"
                variant="secondary"
              >
                重新授權
              </LinkButton>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                尚未授權。授權後系統會建立一個名為「網站到期管理」的專屬日曆，
                每個服務項目對應一個全天事件，到期日變更時事件會跟著移動。
              </p>
              <LinkButton href="/api/google/calendar/authorize">
                授權 Google Calendar
              </LinkButton>
            </div>
          )}

          <div className="rounded-lg border border-border bg-surface-muted p-4 text-xs text-muted">
            <p className="font-medium text-foreground">兩件事先說明</p>
            <p className="mt-1.5">
              1. Google Calendar 的事件提醒上限是 28 天，所以 90 天、60
              天那幾段提醒仍由系統的 Email 與 LINE 負責。日曆的用途是月曆
              視覺化總覽與臨近到期的提醒。
            </p>
            <p className="mt-1.5">
              2. 若 OAuth 應用程式維持「測試中」狀態，Google 發出的
              refresh token 每 7 天就會過期，屆時需要回到這裡重新授權。
              系統偵測到失效會主動寄信通知，不會默默停擺。把應用程式發布到
              正式狀態可以解除這個限制。
            </p>
          </div>
        </div>
      </Card>

      <Card
        title="外部服務"
        description="以環境變數設定，修改後需重新啟動應用程式"
      >
        <div className="divide-y divide-border">
          {[
            {
              label: 'Google 登入',
              on: features.googleLogin,
              hint: 'AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET',
            },
            {
              label: 'Resend 寄信',
              on: features.email,
              hint: 'RESEND_API_KEY / MAIL_FROM（寄件網域需設定 SPF 與 DKIM）',
            },
            {
              label: 'LINE 推播',
              on: features.line,
              hint: 'LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET',
            },
            {
              label: 'LINE 審核寄信',
              on: features.lineApproval,
              hint: '還需要 LINE_ADMIN_USER_ID。未設定時系統不會自動寄信給客戶',
            },
            {
              label: 'Google Calendar 同步',
              on: Boolean(config.gcalCalendarId),
              hint: config.gcalCalendarId
                ? `日曆 ID：${config.gcalCalendarId}`
                : '尚未建立專屬日曆',
            },
          ].map((row) => (
            <div key={row.label} className="flex items-start gap-3 px-5 py-3.5">
              <span className="mt-1.5">
                <StatusDot on={row.on} />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {row.label}
                  <span
                    className={`ml-2 text-xs font-normal ${row.on ? 'text-safe' : 'text-muted'}`}
                  >
                    {row.on ? '已設定' : '待設定'}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted">{row.hint}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="LINE 推播用量">
        <div className="p-5 text-sm">
          <p className="tabular">
            本月已推播{' '}
            <strong className="text-lg">{config.linePushCount}</strong> /{' '}
            {config.linePushMonthlyLimit} 則
          </p>
          <p className="mt-2 text-muted">
            LINE 官方帳號免費方案每月推播則數有限，webhook 的回覆訊息
            （reply message）不計入額度。系統只在有異動時才推播，
            接近上限時會自動改以 Email 遞送，不會漏掉通知。
          </p>
        </div>
      </Card>
    </div>
  )
}
