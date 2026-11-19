'use client'

import { useState } from 'react'

import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui'
import {
  BUILTIN_JOBS,
  BUILTIN_JOB_LABEL,
  HTTP_METHODS,
  INTERVAL_CHOICES,
  SCHEDULED_TASK_KIND_LABEL,
  SCHEDULE_FREQUENCIES,
  SCHEDULE_FREQUENCY_LABEL,
  WEEKDAY_LABEL,
  type ScheduleFrequency,
  type ScheduledTaskKind,
} from '@/lib/schedule'

export type ScheduledTaskFormValue = {
  id: string
  name: string
  kind: ScheduledTaskKind
  job: string | null
  message: string | null
  url: string | null
  method: string | null
  frequency: ScheduleFrequency
  intervalMinutes: number | null
  timeOfDay: string | null
  weekday: number | null
  dayOfMonth: number | null
  enabled: boolean
  system: boolean
}

const intervalLabel = (n: number) => (n >= 60 ? `每 ${n / 60} 小時` : `每 ${n} 分鐘`)

/**
 * 排程任務表單欄位。依「任務類型」與「頻率」只顯示需要的欄位，
 * 所以要在瀏覽器端記住目前選了什麼。
 */
export function ScheduledTaskFields({ task }: { task?: ScheduledTaskFormValue }) {
  const [kind, setKind] = useState<ScheduledTaskKind>(task?.kind ?? 'line_message')
  const [frequency, setFrequency] = useState<ScheduleFrequency>(task?.frequency ?? 'daily')
  const locked = task?.system ?? false

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {task && <input type="hidden" name="id" value={task.id} />}

      <Field label="任務名稱" required>
        <Input name="name" required maxLength={100} defaultValue={task?.name} />
      </Field>

      <Field label="任務類型" hint={locked ? '系統內建任務只能調整時間與啟用狀態' : undefined}>
        <Select
          name="kind"
          value={kind}
          disabled={locked}
          onChange={(e) => setKind(e.target.value as ScheduledTaskKind)}
        >
          {Object.entries(SCHEDULED_TASK_KIND_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {v === 'builtin' ? '系統任務（多加一個時段）' : l}
            </option>
          ))}
        </Select>
        {/* disabled 的欄位不會送出，系統任務改用 hidden 帶值 */}
        {locked && <input type="hidden" name="kind" value={kind} />}
      </Field>

      {kind === 'builtin' && (
        <Field label="要執行的系統任務" required className="sm:col-span-2">
          <Select name="job" defaultValue={task?.job ?? 'expiry-scan'} disabled={locked}>
            {BUILTIN_JOBS.map((job) => (
              <option key={job} value={job}>
                {BUILTIN_JOB_LABEL[job]}（{job}）
              </option>
            ))}
          </Select>
          {locked && <input type="hidden" name="job" value={task?.job ?? ''} />}
        </Field>
      )}

      {kind === 'line_message' && (
        <Field
          label="提醒內容"
          required
          className="sm:col-span-2"
          hint="到時間推一則 LINE 給你；LINE 額度不足時改寄 Email"
        >
          <Textarea name="message" rows={3} maxLength={2000} required defaultValue={task?.message ?? ''} />
        </Field>
      )}

      {kind === 'http_request' && (
        <>
          <Field label="網址" required hint="例：觸發其他網站的 wp-cron 或 webhook；30 秒逾時">
            <Input
              name="url"
              type="url"
              required
              placeholder="https://example.com/wp-cron.php"
              defaultValue={task?.url ?? ''}
            />
          </Field>
          <Field label="方法">
            <Select name="method" defaultValue={task?.method ?? 'GET'}>
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}

      <Field label="執行頻率" hint="時間一律為台北時間">
        <Select
          name="frequency"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as ScheduleFrequency)}
        >
          {SCHEDULE_FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {SCHEDULE_FREQUENCY_LABEL[f]}
            </option>
          ))}
        </Select>
      </Field>

      {frequency === 'interval' && (
        <Field label="間隔">
          <Select name="intervalMinutes" defaultValue={String(task?.intervalMinutes ?? 15)}>
            {INTERVAL_CHOICES.map((n) => (
              <option key={n} value={n}>
                {intervalLabel(n)}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {frequency === 'weekly' && (
        <Field label="星期">
          <Select name="weekday" defaultValue={String(task?.weekday ?? 1)}>
            {WEEKDAY_LABEL.map((label, i) => (
              <option key={label} value={i}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {frequency === 'monthly' && (
        <Field label="每月幾號" hint="選 29–31 號時，該月沒有這天就在月底執行">
          <Select name="dayOfMonth" defaultValue={String(task?.dayOfMonth ?? 1)}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d} 號
              </option>
            ))}
          </Select>
        </Field>
      )}

      {frequency !== 'interval' && (
        <Field label="時間" required>
          <Input name="timeOfDay" type="time" required defaultValue={task?.timeOfDay ?? '09:00'} />
        </Field>
      )}

      <div className="sm:col-span-2">
        <Checkbox
          name="enabled"
          label="啟用"
          defaultChecked={task?.enabled ?? true}
          hint={
            locked
              ? '停用或拉長間隔後，外部監控會因為收不到這支任務的心跳而告警，記得一併調整 PHP 監控的門檻'
              : undefined
          }
        />
      </div>
    </div>
  )
}
