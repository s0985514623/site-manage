import { ActionForm } from '@/components/action-form'
import { Badge, Card } from '@/components/ui'
import type { MailCheckItem, mailChecks, services } from '@/db/schema'
import { mailboxOf, mailDomainOf } from '@/lib/mail-check'
import { checkMailbox } from '@/server/actions/mail-check'

type Status = MailCheckItem['status']

const TONE: Record<Status, 'safe' | 'warning' | 'overdue'> = { ok: 'safe', warn: 'warning', fail: 'overdue' }
const LABEL: Record<Status, string> = { ok: '正常', warn: '注意', fail: '異常' }
const GROUP_LABEL: Record<MailCheckItem['group'], string> = { receive: '收信', send: '寄信' }

const dateTime = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

type EmailService = typeof services.$inferSelect & {
  mailChecks: (typeof mailChecks.$inferSelect)[]
}

/**
 * 網站頁「信箱檢查」：每個使用中的企業信箱服務一格，顯示最近一次結果與「立即檢查」。
 * 沒有企業信箱服務時整張卡片不顯示。
 */
export function MailCheckCard({
  siteId,
  primaryUrl,
  services: all,
}: {
  siteId: string
  primaryUrl: string | null
  services: EmailService[]
}) {
  const mailServices = all.filter((s) => s.type === 'email' && s.status === 'active')
  if (mailServices.length === 0) return null

  return (
    <Card
      title="信箱檢查"
      description="檢查 DNS（MX／SPF／DKIM／DMARC）與收信伺服器，不會真的寄信。每天 08:30 自動檢查，變成異常時用 LINE／Email 通知"
    >
      <div className="divide-y divide-border">
        {mailServices.map((service) => {
          const domain = mailDomainOf(service, { primaryUrl })
          const latest = service.mailChecks[0]
          const mailbox = latest?.mailbox ?? (domain ? mailboxOf(service, domain) : null)
          return (
            <section key={service.id} className="space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{mailbox ?? service.identifier}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {latest
                      ? `上次檢查：${dateTime.format(latest.checkedAt)}`
                      : domain
                        ? '還沒有檢查過'
                        : '沒有可檢查的網域：請在服務項目填寫「偵測目標」，或在網站填寫網址'}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {latest && <Badge tone={TONE[latest.status]}>{LABEL[latest.status]}</Badge>}
                  <ActionForm action={checkMailbox} submitLabel="立即檢查" submitVariant="secondary" savedLabel="已檢查">
                    <input type="hidden" name="id" value={service.id} />
                    <input type="hidden" name="siteId" value={siteId} />
                  </ActionForm>
                </div>
              </div>

              {latest && (
                <ul className="space-y-1.5 text-sm">
                  {latest.results.map((r) => (
                    <li key={r.key} className="flex gap-3">
                      <span className="w-12 shrink-0">
                        <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
                      </span>
                      <span className="w-36 shrink-0 text-muted">
                        {GROUP_LABEL[r.group]}・{r.label.replace(/（.*）$/, '')}
                      </span>
                      <span className="min-w-0 break-words">{r.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </Card>
  )
}
