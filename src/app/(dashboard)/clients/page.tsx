import Link from 'next/link'

import { ActionForm, Disclosure } from '@/components/action-form'
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Table,
  Td,
  Textarea,
  Th,
} from '@/components/ui'
import { createClient } from '@/server/actions/clients'
import { listClients } from '@/server/queries'

export const metadata = { title: '客戶' }
export const dynamic = 'force-dynamic'

function NewClientForm() {
  return (
    <Disclosure label="新增客戶">
      <ActionForm action={createClient} submitLabel="建立客戶" resetOnSuccess>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="客戶全名" required className="sm:col-span-2">
            <Input
              name="name"
              required
              placeholder="例：財團法人台北市九如禪林基金會"
            />
          </Field>
          <Field
            label="簡稱"
            hint="報價單「專案名稱」用，全名太長時很有用。留空則用全名"
          >
            <Input name="shortName" placeholder="九如基金會" />
          </Field>
          <Field label="統一編號" hint="報價單上需要，可之後補填">
            <Input name="taxId" inputMode="numeric" placeholder="12345678" />
          </Field>
          <Field label="負責人" hint="報價單甲乙方對照區需要">
            <Input name="representative" />
          </Field>
          <Field label="電話">
            <Input name="phone" placeholder="02-1234-5678" />
          </Field>
          <Field label="地址" className="sm:col-span-2">
            <Input name="address" />
          </Field>
          <Field label="備註" className="sm:col-span-2">
            <Textarea name="note" placeholder="付款習慣、注意事項…" />
          </Field>
        </div>
      </ActionForm>
    </Disclosure>
  )
}

export default async function ClientsPage() {
  const rows = await listClients()

  return (
    <div>
      <PageHeader
        title="客戶"
        description="每個客戶底下掛網站，網站底下再登記各項會到期的服務"
      />

      <div className="mb-6">
        <NewClientForm />
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="還沒有客戶"
            description="先建立一個客戶，再把他的網站與網域、主機、維護合約登記進來。"
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>客戶</Th>
                <Th>統編</Th>
                <Th align="right">網站</Th>
                <Th align="right">服務項目</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-surface-muted">
                  <Td>
                    <Link
                      href={`/clients/${row.id}`}
                      className="font-medium hover:text-accent"
                    >
                      {row.name}
                    </Link>
                    {row.status === 'inactive' && (
                      <span className="ml-2">
                        <Badge>已停用</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="tabular text-muted">{row.taxId ?? '—'}</Td>
                  <Td align="right" className="tabular">
                    {row.siteCount}
                  </Td>
                  <Td align="right" className="tabular">
                    {row.serviceCount}
                  </Td>
                  <Td align="right">
                    <Link
                      href={`/clients/${row.id}`}
                      className="text-sm text-accent hover:underline"
                    >
                      查看
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
