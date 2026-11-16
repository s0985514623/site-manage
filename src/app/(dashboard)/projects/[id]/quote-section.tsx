import { asc, eq } from 'drizzle-orm'

import { ActionForm, Disclosure } from '@/components/action-form'
import { Card, Input, Select } from '@/components/ui'
import { db } from '@/db'
import { plans, type Project, type Quote } from '@/db/schema'
import { createProjectQuoteAction } from '@/server/actions/projects'

const ROWS = 5

/**
 * 從專案產生報價草稿。項目手動輸入；選方案範本時，說明與單價留空會帶入範本內容，
 * 規格說明一律取範本。寄送依寄送模式（設定頁）。
 */
export async function ProjectQuoteSection({
  project,
  quotes,
}: {
  project: Project
  quotes: Quote[]
}) {
  const planOptions = await db
    .select({ id: plans.id, name: plans.name })
    .from(plans)
    .where(eq(plans.active, true))
    .orderBy(asc(plans.sortOrder))

  return (
    <Card
      title="產生報價"
      description={
        quotes.length > 0
          ? `已有 ${quotes.length} 張報價單，可以再產生一張（例如追加功能）`
          : '項目說明、數量、單位、單價。空白列會略過'
      }
    >
      <div className="p-5">
        <Disclosure label="產生報價草稿">
          <ActionForm action={createProjectQuoteAction} submitLabel="產生草稿">
            <input type="hidden" name="id" value={project.id} />
            <div className="space-y-2">
              <div className="hidden gap-2 text-xs text-muted sm:grid sm:grid-cols-[1fr_5rem_4rem_8rem_10rem]">
                <span>說明</span>
                <span>數量</span>
                <span>單位</span>
                <span>單價</span>
                <span>方案範本（選填）</span>
              </div>
              {Array.from({ length: ROWS }, (_, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_5rem_4rem_8rem_10rem]">
                  <Input name="description" placeholder={i === 0 ? '官網設計製作' : ''} />
                  <Input name="quantity" inputMode="decimal" defaultValue="1" />
                  <Input name="unit" defaultValue="式" />
                  <Input name="unitPrice" inputMode="decimal" />
                  <Select name="planId" defaultValue="">
                    <option value="">—</option>
                    {planOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          </ActionForm>
        </Disclosure>
      </div>
    </Card>
  )
}
