import { ActionForm } from '@/components/action-form'
import { Card, Field, Input, Select } from '@/components/ui'
import type { Project, Site } from '@/db/schema'
import { CYCLE_LABEL, plusDays, today } from '@/lib/dates'
import { SERVICE_TYPE_LABEL } from '@/lib/labels'
import { submitHandoverAction } from '@/server/actions/projects'
import { HANDOVER_TYPES } from '@/server/projects/handover-types'

/**
 * 新網站專案完成後的轉維運表單：勾選要建立的服務項目，當下填好到期日與售價。
 * 售價留空的服務項目不會產生續約報價（會被略過），所以這裡設為必填。
 */
export function HandoverSection({ project }: { project: Project & { site: Site | null } }) {
  const nextYear = plusDays(today(), 365)
  return (
    <Card
      title="轉維運"
      description="新網站已完成：勾選要開始追蹤到期的服務項目。送出後會建立服務項目並寫入「網站到期管理」日曆，只能送出一次。"
      className="border-warning/40"
    >
      <div className="p-5">
        <ActionForm action={submitHandoverAction} submitLabel="送出轉維運">
          <input type="hidden" name="id" value={project.id} />
          {!project.site && (
            <div className="mb-5 grid gap-4 sm:grid-cols-2">
              <Field label="網站名稱" hint="專案沒有綁網站，會建立一個新網站">
                <Input name="siteName" defaultValue={project.name} />
              </Field>
              <Field label="網址">
                <Input name="siteUrl" placeholder="https://" />
              </Field>
            </div>
          )}
          <div className="space-y-3">
            {HANDOVER_TYPES.map((type) => (
              <fieldset
                key={type}
                className="grid items-end gap-3 rounded-lg border border-border p-3 sm:grid-cols-[auto_1fr_10rem_8rem_7rem]"
              >
                <label className="flex items-center gap-2 pb-2 text-sm font-medium">
                  <input type="checkbox" name={`include_${type}`} defaultChecked={type !== 'ssl'} />
                  {SERVICE_TYPE_LABEL[type]}
                </label>
                <Field label="名稱">
                  <Input
                    name={`identifier_${type}`}
                    placeholder={type === 'domain' ? 'example.com.tw' : `${SERVICE_TYPE_LABEL[type]}方案`}
                  />
                </Field>
                <Field label="到期日">
                  <Input type="date" name={`expiresAt_${type}`} defaultValue={nextYear} />
                </Field>
                <Field label="售價">
                  <Input name={`price_${type}`} inputMode="decimal" />
                </Field>
                <Field label="週期">
                  <Select name={`cycle_${type}`} defaultValue="yearly">
                    {Object.entries(CYCLE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </fieldset>
            ))}
          </div>
        </ActionForm>
      </div>
    </Card>
  )
}
