import { ActionForm, Disclosure } from './action-form'
import { Checkbox, Field, Input } from './ui'
import { today } from '@/lib/dates'
import { uploadQuoteAction } from '@/server/actions/quotes'

/**
 * 上傳外部做好的報價單 PDF，建成正式報價單（可寄出、追蹤、登記收款）。
 * 專案頁與網站頁共用；成功後跳到報價單頁。
 */
export function UploadQuoteForm({
  target,
  defaultTitle,
}: {
  target: { projectId: string } | { siteId: string }
  defaultTitle: string
}) {
  return (
    <Disclosure label="上傳報價單 PDF">
      <ActionForm action={uploadQuoteAction} submitLabel="上傳並建立報價單">
        {'projectId' in target ? (
          <input type="hidden" name="projectId" value={target.projectId} />
        ) : (
          <input type="hidden" name="siteId" value={target.siteId} />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="報價單 PDF" required className="sm:col-span-2" hint="只收 PDF，上限 10MB。寄給客戶時附上的就是這個檔案">
            <Input
              name="file"
              type="file"
              required
              accept=".pdf,application/pdf"
              className="file:mr-3 file:rounded-md file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm"
            />
          </Field>
          <Field label="合計金額" required hint="客戶實際要付的金額（含稅）">
            <Input name="total" inputMode="decimal" required placeholder="36000" />
          </Field>
          <Field label="單號" hint="留空 = 依開立日自動編號">
            <Input name="quoteNo" placeholder="261124" />
          </Field>
          <Field label="標題" hint="留空 = 名稱">
            <Input name="title" placeholder={defaultTitle} />
          </Field>
          <Field label="開立日期" required>
            <Input name="issueDate" type="date" required defaultValue={today()} />
          </Field>
          <Field label="有效期限" hint="留空 = 依設定的報價有效天數">
            <Input name="validUntil" type="date" />
          </Field>
          <div className="sm:col-span-2">
            <Checkbox
              name="alreadySent"
              label="我已經自己寄給客戶了（直接標記為已寄出）"
              hint="勾選後會進入「追蹤未回覆」；不勾則停在草稿，可在報價單頁由系統寄出"
            />
          </div>
        </div>
      </ActionForm>
    </Disclosure>
  )
}
