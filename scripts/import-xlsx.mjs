/**
 * 從 Excel 範本匯入客戶、網站、服務項目與聯絡人。
 *
 *   node scripts/import-xlsx.mjs <檔案.xlsx>          先試算，不寫入
 *   node scripts/import-xlsx.mjs <檔案.xlsx> --apply  確認後實際寫入
 *
 * 預設只試算：匯入是會改動整個資料庫的操作，先看清楚要建立什麼再執行。
 * 同名客戶與同客戶下的同名網站會自動合併，重複執行不會產生分身。
 */

import path from 'node:path'

import { config } from 'dotenv'
import postgres from 'postgres'
import XLSX from 'xlsx'

config({ path: '.env.local', quiet: true })

const file = process.argv[2]
const apply = process.argv.includes('--apply')

if (!file) {
  console.error('用法：node scripts/import-xlsx.mjs <檔案.xlsx> [--apply]')
  process.exit(1)
}

/* ------------------------------------------------------------------ */
/* 中文選項 → 資料庫列舉                                                 */
/* ------------------------------------------------------------------ */

const SERVICE_TYPE = {
  網域: 'domain',
  主機: 'hosting',
  SSL憑證: 'ssl',
  維護合約: 'maintenance',
  企業信箱: 'email',
  外掛授權: 'license',
  CDN: 'cdn',
  其他: 'other',
}
const CYCLE = {
  每月: 'monthly',
  每季: 'quarterly',
  每年: 'yearly',
  每兩年: 'biennial',
  每三年: 'triennial',
}
const SITE_STATUS = {
  建置中: 'building',
  已上線: 'live',
  暫停: 'paused',
  已結案: 'closed',
}
const ROLE = {
  決策者: 'decision',
  財務窗口: 'finance',
  技術窗口: 'tech',
  其他: 'other',
}

const str = (v) => (v === null || v === undefined ? '' : String(v).trim())
const bool = (v) => str(v) === '是'
const num = (v) => {
  const t = str(v)
  if (!t) return null
  const n = Number(t.replace(/,/g, ''))
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : null
}

/** Excel 可能把日期存成序號、Date 物件或字串，統一成 YYYY-MM-DD */
function toDate(value) {
  if (value === null || value === undefined || value === '') return null

  if (value instanceof Date) {
    // 用 UTC 取值：xlsx 解析出的 Date 就是以 UTC 表示那一天
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed) return null
    const p = (n) => String(n).padStart(2, '0')
    return `${parsed.y}-${p(parsed.m)}-${p(parsed.d)}`
  }
  const text = String(value).trim()
  const m = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (!m) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${m[1]}-${p(m[2])}-${p(m[3])}`
}

/* ------------------------------------------------------------------ */
/* 讀取                                                                 */
/* ------------------------------------------------------------------ */

/** 範本第 1 列是標題、第 2 列是填寫說明，資料從第 3 列開始 */
function readSheet(wb, name) {
  const sheet = wb.Sheets[name]
  if (!sheet) return []
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  })
  if (rows.length < 3) return []

  const headers = rows[0].map((h) => String(h ?? '').replace(/\s*\*$/, '').trim())
  return rows
    .slice(2)
    .map((row) => {
      const out = {}
      headers.forEach((h, i) => {
        if (h) out[h] = row[i]
      })
      return out
    })
    .filter((row) => Object.values(row).some((v) => str(v) !== ''))
}

const problems = []
function problem(sheet, rowNo, message) {
  problems.push(`${sheet} 第 ${rowNo} 列：${message}`)
}

async function main() {
  const wb = XLSX.readFile(path.resolve(file), { cellDates: true })
  console.log(`讀取 ${path.basename(file)}　分頁：${wb.SheetNames.join(' / ')}\n`)

  const serviceRows = readSheet(wb, '服務項目')
  const contactRows = readSheet(wb, '聯絡人')

  /* ---------- 整理成階層結構 ---------- */
  const clients = new Map() // 客戶全名 → { ...欄位, sites: Map }

  serviceRows.forEach((row, index) => {
    const rowNo = index + 3
    const clientName = str(row['客戶全名'])
    const siteName = str(row['網站名稱'])
    const identifier = str(row['項目名稱'])
    const typeLabel = str(row['服務類型'])
    const cycleLabel = str(row['計費週期']) || '每年'
    const expiresAt = toDate(row['到期日'])

    if (!clientName) return problem('服務項目', rowNo, '缺少客戶全名')
    if (!siteName) return problem('服務項目', rowNo, '缺少網站名稱')
    if (!identifier) return problem('服務項目', rowNo, '缺少項目名稱')
    if (!SERVICE_TYPE[typeLabel]) {
      return problem('服務項目', rowNo, `服務類型「${typeLabel}」不是允許的值`)
    }
    if (!CYCLE[cycleLabel]) {
      return problem('服務項目', rowNo, `計費週期「${cycleLabel}」不是允許的值`)
    }
    if (!expiresAt) {
      return problem('服務項目', rowNo, `到期日無法解析：${str(row['到期日'])}`)
    }

    const taxId = str(row['統一編號'])
    if (taxId && !/^\d{8}$/.test(taxId)) {
      problem('服務項目', rowNo, `統一編號「${taxId}」不是 8 位數字`)
    }

    if (!clients.has(clientName)) {
      clients.set(clientName, {
        name: clientName,
        shortName: str(row['客戶簡稱']) || null,
        taxId: taxId || null,
        representative: str(row['客戶負責人']) || null,
        phone: str(row['客戶電話']) || null,
        address: str(row['客戶地址']) || null,
        sites: new Map(),
        contacts: [],
      })
    }
    const client = clients.get(clientName)

    if (!client.sites.has(siteName)) {
      client.sites.set(siteName, {
        name: siteName,
        primaryUrl: str(row['網站網址']) || null,
        cmsType: str(row['CMS平台']) || null,
        status: SITE_STATUS[str(row['網站狀態'])] ?? 'live',
        services: [],
      })
    }

    client.sites.get(siteName).services.push({
      rowNo,
      type: SERVICE_TYPE[typeLabel],
      identifier,
      detectHost: str(row['偵測目標']) || null,
      provider: str(row['供應商']) || null,
      providerAccount: str(row['註冊商帳號']) || null,
      isOurs: str(row['我方代管']) === '' ? true : bool(row['我方代管']),
      startedAt: toDate(row['開始日']),
      expiresAt,
      billingCycle: CYCLE[cycleLabel],
      autoRenew: bool(row['自動續約']),
      costAmount: num(row['成本價']),
      priceAmount: num(row['售價']),
      currency: str(row['幣別']) || 'TWD',
      planName: str(row['方案範本']) || null,
      specNote: str(row['規格說明']) || null,
      note: str(row['備註']) || null,
    })
  })

  contactRows.forEach((row, index) => {
    const rowNo = index + 3
    const clientName = str(row['客戶全名'])
    const name = str(row['姓名'])
    if (!clientName) return problem('聯絡人', rowNo, '缺少客戶全名')
    if (!name) return problem('聯絡人', rowNo, '缺少姓名')

    const client = clients.get(clientName)
    if (!client) {
      return problem(
        '聯絡人',
        rowNo,
        `找不到客戶「${clientName}」。請確認與「服務項目」分頁的寫法完全一致`,
      )
    }

    const email = str(row['Email'])
    const receiveQuotes = bool(row['接收報價單'])
    if (receiveQuotes && !email) {
      return problem('聯絡人', rowNo, '勾選「接收報價單」但沒有填 Email')
    }

    client.contacts.push({
      name,
      role: ROLE[str(row['角色'])] ?? 'other',
      email: email || null,
      phone: str(row['電話']) || null,
      isPrimary: bool(row['主要聯絡人']),
      receiveQuotes,
    })
  })

  /* ---------- 試算摘要 ---------- */
  let siteCount = 0
  let serviceCount = 0
  let contactCount = 0
  for (const client of clients.values()) {
    siteCount += client.sites.size
    contactCount += client.contacts.length
    for (const site of client.sites.values()) serviceCount += site.services.length
  }

  console.log('將建立：')
  console.log(`  客戶　　 ${clients.size}`)
  console.log(`  網站　　 ${siteCount}`)
  console.log(`  服務項目 ${serviceCount}`)
  console.log(`  聯絡人　 ${contactCount}`)

  for (const client of clients.values()) {
    console.log(`\n  ${client.name}${client.shortName ? `（${client.shortName}）` : ''}`)
    for (const site of client.sites.values()) {
      console.log(`    ${site.name}`)
      for (const s of site.services) {
        const owner = s.isOurs ? '代管' : '客戶自管'
        const price = s.priceAmount ? `NT$${Number(s.priceAmount).toLocaleString()}` : '未設價'
        console.log(`      ${s.expiresAt}  ${s.identifier.padEnd(20)} ${owner}  ${price}`)
      }
    }
    for (const c of client.contacts) {
      console.log(`    聯絡人：${c.name}${c.receiveQuotes ? '（收報價單）' : ''} ${c.email ?? ''}`)
    }
  }

  if (problems.length > 0) {
    console.log(`\n發現 ${problems.length} 個問題，這些列會被略過：`)
    for (const p of problems) console.log(`  ・${p}`)
  }

  if (!apply) {
    console.log('\n以上為試算結果，尚未寫入資料庫。')
    console.log('確認無誤後加上 --apply 實際匯入：')
    console.log(`  node scripts/import-xlsx.mjs "${file}" --apply`)
    return 0
  }

  /* ---------- 寫入 ---------- */
  const sql = postgres(process.env.DATABASE_URL, { max: 1 })
  let created = { clients: 0, sites: 0, services: 0, contacts: 0 }

  try {
    // 方案名稱 → id，讓範本可以用中文名指定方案
    const planRows = await sql`SELECT id, name FROM plans`
    const planByName = new Map(planRows.map((p) => [p.name, p.id]))

    await sql.begin(async (tx) => {
      for (const client of clients.values()) {
        // 同名客戶視為既有，只補空欄位不覆蓋既有內容
        const existing = await tx`
          SELECT id FROM clients WHERE name = ${client.name} LIMIT 1`
        let clientId
        if (existing.length > 0) {
          clientId = existing[0].id
          await tx`
            UPDATE clients SET
              short_name = coalesce(short_name, ${client.shortName}),
              tax_id = coalesce(tax_id, ${client.taxId}),
              representative = coalesce(representative, ${client.representative}),
              phone = coalesce(phone, ${client.phone}),
              address = coalesce(address, ${client.address}),
              updated_at = now()
            WHERE id = ${clientId}`
        } else {
          const [row] = await tx`
            INSERT INTO clients (name, short_name, tax_id, representative, phone, address)
            VALUES (${client.name}, ${client.shortName}, ${client.taxId},
                    ${client.representative}, ${client.phone}, ${client.address})
            RETURNING id`
          clientId = row.id
          created.clients++
        }

        for (const contact of client.contacts) {
          const dup = await tx`
            SELECT id FROM contacts
            WHERE client_id = ${clientId} AND name = ${contact.name} LIMIT 1`
          if (dup.length > 0) continue
          if (contact.isPrimary) {
            await tx`UPDATE contacts SET is_primary = false WHERE client_id = ${clientId}`
          }
          await tx`
            INSERT INTO contacts (client_id, name, role, email, phone, is_primary, receive_quotes)
            VALUES (${clientId}, ${contact.name}, ${contact.role}, ${contact.email},
                    ${contact.phone}, ${contact.isPrimary}, ${contact.receiveQuotes})`
          created.contacts++
        }

        for (const site of client.sites.values()) {
          const existingSite = await tx`
            SELECT id FROM sites
            WHERE client_id = ${clientId} AND name = ${site.name} LIMIT 1`
          let siteId
          if (existingSite.length > 0) {
            siteId = existingSite[0].id
          } else {
            const [row] = await tx`
              INSERT INTO sites (client_id, name, primary_url, cms_type, status)
              VALUES (${clientId}, ${site.name}, ${site.primaryUrl},
                      ${site.cmsType}, ${site.status})
              RETURNING id`
            siteId = row.id
            created.sites++
          }

          for (const s of site.services) {
            // 同一網站下同名項目視為已存在，不重複建立
            const dup = await tx`
              SELECT id FROM services
              WHERE site_id = ${siteId} AND identifier = ${s.identifier} LIMIT 1`
            if (dup.length > 0) continue

            const planId = s.planName ? (planByName.get(s.planName) ?? null) : null
            if (s.planName && !planId) {
              console.warn(`  ! 找不到方案範本「${s.planName}」，該項目改為不套用範本`)
            }

            await tx`
              INSERT INTO services (
                site_id, type, identifier, detect_host, provider, provider_account,
                is_ours, started_at, expires_at, billing_cycle, auto_renew,
                cost_amount, price_amount, currency, plan_id, spec_note, note
              ) VALUES (
                ${siteId}, ${s.type}, ${s.identifier}, ${s.detectHost}, ${s.provider},
                ${s.providerAccount}, ${s.isOurs}, ${s.startedAt}, ${s.expiresAt},
                ${s.billingCycle}, ${s.autoRenew}, ${s.costAmount}, ${s.priceAmount},
                ${s.currency}, ${planId}, ${s.specNote}, ${s.note}
              )`
            created.services++
          }
        }
      }
    })

    console.log('\n匯入完成，新增：')
    console.log(`  客戶 ${created.clients}　網站 ${created.sites}　服務項目 ${created.services}　聯絡人 ${created.contacts}`)
    console.log('\n（既有的同名資料不會被覆蓋，重複執行不會產生分身）')
  } finally {
    await sql.end()
  }

  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('\n匯入失敗，資料庫未變更：')
    console.error(error)
    process.exit(1)
  })
