import { Field, Input, Select, Textarea } from '@/components/ui'
import type { Project } from '@/db/schema'
import { CATEGORY_LABEL, type ProjectStatus } from '@/server/projects/projects'

export const STATUS_TONE: Record<ProjectStatus, 'neutral' | 'accent' | 'warning' | 'safe'> = {
  not_started: 'neutral',
  in_progress: 'accent',
  in_review: 'warning',
  completed: 'safe',
}

export type ClientOption = { id: string; name: string }
export type SiteOption = { id: string; name: string; clientId: string; clientName: string }

/**
 * 建立 / 編輯專案共用欄位。網站下拉以客戶分組列出；選了別的客戶的網站時，
 * 存檔會被擋下（SITE_CLIENT_MISMATCH），不在前端另寫一套連動邏輯。
 */
export function ProjectFields({
  clients,
  sites,
  project,
}: {
  clients: ClientOption[]
  sites: SiteOption[]
  project?: Project
}) {
  const byClient = new Map<string, SiteOption[]>()
  for (const s of sites) {
    byClient.set(s.clientName, [...(byClient.get(s.clientName) ?? []), s])
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="專案名稱" required className="sm:col-span-2">
        <Input name="name" required defaultValue={project?.name} placeholder="例：青禾新官網" />
      </Field>
      <Field label="客戶" required>
        <Select name="clientId" required defaultValue={project?.clientId ?? ''}>
          <option value="" disabled>
            選擇客戶
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="類別" required>
        <Select name="category" required defaultValue={project?.category ?? ''}>
          <option value="" disabled>
            選擇類別
          </option>
          {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="網站" hint="新網站專案可以先不選，轉維運時再建立網站" className="sm:col-span-2">
        <Select name="siteId" defaultValue={project?.siteId ?? ''}>
          <option value="">不指定</option>
          {[...byClient.entries()].map(([clientName, list]) => (
            <optgroup key={clientName} label={clientName}>
              {list.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>
      <Field label="開始日">
        <Input type="date" name="startDate" defaultValue={project?.startDate ?? ''} />
      </Field>
      <Field label="截止日" hint="有填會寫入 Google「專案管理」日曆">
        <Input type="date" name="dueDate" defaultValue={project?.dueDate ?? ''} />
      </Field>
      <Field label="預估金額">
        <Input
          name="estimatedAmount"
          inputMode="decimal"
          defaultValue={project?.estimatedAmount ?? ''}
          placeholder="60000"
        />
      </Field>
      <Field label="說明" className="sm:col-span-2">
        <Textarea name="description" defaultValue={project?.description ?? ''} />
      </Field>
    </div>
  )
}
