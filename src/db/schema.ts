import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

/**
 * Postgres bytea。Drizzle 沒有內建這個型別，自訂一個以 Buffer 進出。
 * 用於存放回簽報價單等檔案內容。
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

/**
 * 金額一律 numeric(12,2)，Drizzle 以 string 進出，避免 JavaScript 浮點誤差。
 * 實際加總與稅額計算在 src/lib/money.ts 中以整數「分」為單位處理。
 */
const money = (name: string) => numeric(name, { precision: 12, scale: 2 })

/**
 * 到期日一律 date（非 timestamp）。時區換算會讓 timestamp 差一天，
 * 而「網域哪一天到期」本質上是日曆日期，不是時間點。
 */
const day = (name: string) => date(name, { mode: 'string' })

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const clientStatusEnum = pgEnum('client_status', ['active', 'inactive'])

export const contactRoleEnum = pgEnum('contact_role', [
  'decision', // 決策者
  'finance', // 財務／請款窗口
  'tech', // 技術窗口
  'other',
])

export const siteStatusEnum = pgEnum('site_status', [
  'building', // 建置中
  'live', // 已上線
  'paused', // 暫停
  'closed', // 已結案
])

export const serviceTypeEnum = pgEnum('service_type', [
  'domain', // 網域
  'hosting', // 主機／虛擬空間
  'ssl', // SSL 憑證
  'maintenance', // 維護合約
  'email', // 企業信箱
  'license', // 付費外掛／佈景授權
  'cdn', // CDN
  'other',
])

export const billingCycleEnum = pgEnum('billing_cycle', [
  'monthly',
  'quarterly',
  'yearly',
  'biennial', // 兩年
  'triennial', // 三年
])

export const serviceStatusEnum = pgEnum('service_status', [
  'active',
  'expired',
  'cancelled',
])

/** 續約流程狀態機，詳見 src/lib/quote-builder.ts */
export const renewalStateEnum = pgEnum('renewal_state', [
  'upcoming', // 尚未進入報價窗口
  'drafted', // 已被納入草稿報價單
  'pending_approval', // 已推 LINE，等你確認
  'sent', // 已寄給客戶
  'accepted', // 客戶已同意
  'renewed', // 已完成續約（到期日已推進）
  'declined', // 客戶不續約
])

export const quoteStatusEnum = pgEnum('quote_status', [
  'draft',
  'pending_approval',
  'sent',
  'accepted',
  'rejected', // 客戶拒絕
  'cancelled', // 你在 LINE 上按取消
  'expired', // 超過有效期限未回覆
])

export const taxModeEnum = pgEnum('tax_mode', [
  'exclusive', // 未稅（金額外加 5% 營業稅）
  'inclusive', // 含稅（金額已內含稅）
  'none', // 免稅
])

export const approvalActionEnum = pgEnum('approval_action', [
  'approve',
  'reject',
])

export const notifyChannelEnum = pgEnum('notify_channel', ['email', 'line'])

export const detectSourceEnum = pgEnum('detect_source', ['whois', 'tls'])

export const projectCategoryEnum = pgEnum('project_category', [
  'new_site', // 新網站（完成時觸發轉維運）
  'custom_plugin', // 客製化外掛
  'bug_fix', // BUG 排除
  'other',
])

export const projectStatusEnum = pgEnum('project_status', [
  'not_started', // 待開始
  'in_progress', // 進行中
  'in_review', // 待驗收
  'completed', // 已完成
])

/** 通知種類：決定 notifications 用哪一組去重鍵 */
export const notifyKindEnum = pgEnum('notify_kind', [
  'expiry', // 到期提醒（既有行為）
  'quote_followup', // 報價未回覆追蹤
  'payment_followup', // 未收款追蹤
  'weekly_report', // 每週週報
  'quote_draft', // 手動寄送模式下的草稿純通知
])

/** LINE 快速新增專案的逐步問答進度 */
export const lineFlowStepEnum = pgEnum('line_flow_step', [
  'choose_client',
  'choose_category',
  'input_name',
  'choose_due_date',
])

/* ------------------------------------------------------------------ */
/* 客戶                                                                 */
/* ------------------------------------------------------------------ */

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 正式全名，印在報價單甲方欄與合約上 */
  name: text('name').notNull(),
  /**
   * 簡稱，用於報價單的「專案名稱」。
   * 全名如「財團法人台北市九如禪林基金會」放進專案名稱會太長，
   * 慣例上寫「九如基金會主機續約」。未填則退回使用全名。
   */
  shortName: text('short_name'),
  taxId: text('tax_id'), // 統一編號
  /** 負責人。報價單下方的甲乙方對照區需要 */
  representative: text('representative'),
  address: text('address'),
  phone: text('phone'),
  note: text('note'),
  status: clientStatusEnum('status').notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/* ------------------------------------------------------------------ */
/* 聯絡人（一個客戶可有多位窗口）                                          */
/* ------------------------------------------------------------------ */

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: contactRoleEnum('role').notNull().default('other'),
    email: text('email'),
    phone: text('phone'),
    isPrimary: boolean('is_primary').notNull().default(false),
    /** 報價單寄送時的收件人。可多位，會一起列在 LINE 確認訊息上供核對 */
    receiveQuotes: boolean('receive_quotes').notNull().default(false),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('contacts_client_idx').on(t.clientId)],
)

/* ------------------------------------------------------------------ */
/* 網站（報價合併的單位）                                                 */
/* ------------------------------------------------------------------ */

export const sites = pgTable(
  'sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    primaryUrl: text('primary_url'),
    cmsType: text('cms_type'), // WordPress / Shopify / 靜態站 ...
    status: siteStatusEnum('status').notNull().default('live'),
    /** A 記錄指向哪台主機、MX 指向哪、是否走 Cloudflare — 換主機時能省半天 */
    dnsNote: text('dns_note'),
    /** 存活監控開關與連續失敗計數（連續 2 次失敗才告警，避免瞬斷誤報） */
    monitorEnabled: boolean('monitor_enabled').notNull().default(false),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastUptimeOk: boolean('last_uptime_ok'),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('sites_client_idx').on(t.clientId)],
)

/* ------------------------------------------------------------------ */
/* 報價單                                                               */
/* ------------------------------------------------------------------ */

export const quotes = pgTable(
  'quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    quoteNo: text('quote_no').notNull(), // YYMMDD，同日多張則為 YYMMDD-2
    /** 專案名稱，例如「九如基金會主機續約」 */
    projectName: text('project_name'),
    /** 交付方式，例如「主機續約」 */
    deliveryMethod: text('delivery_method'),
    /** 匯款期限警語，產生時由範本填入實際日期 */
    paymentNote: text('payment_note'),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    /**
     * 合併單位：同一網站的到期項目合成一張單。
     * 專案報價可以不綁網站（新網站專案建立時網站還不存在），
     * 但 site_id 與 project_id 至少要有一個（見下方 CHECK）。
     */
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'restrict' }),
    /** 由專案產生的報價單才有值。有報價單的專案不可刪除 */
    projectId: uuid('project_id').references((): AnyPgColumn => projects.id, {
      onDelete: 'restrict',
    }),
    status: quoteStatusEnum('status').notNull().default('draft'),

    /** 錨點 = 此網站最早到期的項目，合併窗口由此日往後推算。專案報價沒有錨點 */
    anchorServiceId: uuid('anchor_service_id'),
    anchorDate: day('anchor_date'),

    issueDate: day('issue_date').notNull(),
    validUntil: day('valid_until').notNull(),
    currency: text('currency').notNull().default('TWD'),

    taxMode: taxModeEnum('tax_mode').notNull().default('exclusive'),
    taxRate: numeric('tax_rate', { precision: 5, scale: 4 })
      .notNull()
      .default('0.0500'),

    subtotal: money('subtotal').notNull().default('0'),
    taxAmount: money('tax_amount').notNull().default('0'),
    total: money('total').notNull().default('0'),

    note: text('note'),
    terms: text('terms'),

    pdfKey: text('pdf_key'),
    linePushedAt: timestamp('line_pushed_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** 實際寄達的收件人，寄出後留存以備查 */
    sentTo: jsonb('sent_to').$type<string[]>(),

    /** 客戶同意時間。專案報價的未收款提醒由此起算 */
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    /** 收款日（不可晚於今天）與實收金額（> 0）。有值 = 已收款 */
    paidOn: day('paid_on'),
    paidAmount: money('paid_amount'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('quotes_quote_no_key').on(t.quoteNo),
    index('quotes_client_idx').on(t.clientId),
    index('quotes_site_idx').on(t.siteId),
    index('quotes_status_idx').on(t.status),
    index('quotes_project_idx').on(t.projectId),
    check(
      'quotes_site_or_project',
      sql`${t.siteId} is not null or ${t.projectId} is not null`,
    ),
  ],
)

/* ------------------------------------------------------------------ */
/* 方案範本                                                             */
/* ------------------------------------------------------------------ */

/**
 * 報價單上「概要／功能說明」那一格的文字來源。
 *
 * 主機規格（空間多大、備份保留幾天、含不含 SSL）每年續約都是同一套，
 * 存成範本後建立服務項目時選一次，往後每年自動帶入，不必重打。
 */
export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(), // 基本方案 / 流量方案 30 萬
    type: serviceTypeEnum('type').notNull().default('hosting'),
    /** 多行規格說明，原樣印在報價單上 */
    specNote: text('spec_note').notNull(),
    /** 建立服務項目時帶入的預設售價，可再調整 */
    priceAmount: money('price_amount'),
    billingCycle: billingCycleEnum('billing_cycle').notNull().default('yearly'),
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('plans_sort_idx').on(t.sortOrder)],
)

/* ------------------------------------------------------------------ */
/* 服務項目（核心表：所有「會到期的東西」）                                  */
/* ------------------------------------------------------------------ */

export const services = pgTable(
  'services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    type: serviceTypeEnum('type').notNull(),
    /** 網域名稱 / 主機方案名 / 外掛名 */
    identifier: text('identifier').notNull(),
    provider: text('provider'), // Gandi / Cloudflare / 中華電信 ...
    providerAccount: text('provider_account'), // 註冊在誰的帳號下
    /** 網域轉移必備的 EPP / Auth Code，加密儲存 */
    authCodeEncrypted: text('auth_code_encrypted'),

    /**
     * 自動偵測的目標網域或網址。
     *
     * identifier 是印在報價單上的「名稱」，實務上常寫成
     * 「網域名稱續約」這種中文標籤，拿去查 WHOIS 會失敗。
     * 這個欄位讓兩件事分開：顯示用 identifier，偵測用這裡。
     * 留空時，若 identifier 本身看起來像網域就用它。
     */
    detectHost: text('detect_host'),

    /** 套用的方案範本，報價時用來帶出規格說明 */
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'set null' }),
    /** 自訂規格說明。有值時覆蓋方案範本的內容 */
    specNote: text('spec_note'),

    /**
     * true  = 我方代管代購 → 會納入報價單計費
     * false = 客戶自己買的 → 照常提醒，但絕不計費（否則重複收費）
     */
    isOurs: boolean('is_ours').notNull().default(true),

    startedAt: day('started_at'),
    expiresAt: day('expires_at').notNull(),
    billingCycle: billingCycleEnum('billing_cycle').notNull().default('yearly'),
    autoRenew: boolean('auto_renew').notNull().default(false),

    costAmount: money('cost_amount'), // 你付給供應商
    priceAmount: money('price_amount'), // 你跟客戶收
    currency: text('currency').notNull().default('TWD'),

    status: serviceStatusEnum('status').notNull().default('active'),
    renewalState: renewalStateEnum('renewal_state')
      .notNull()
      .default('upcoming'),
    /** 目前涵蓋此項目的報價單，用來防止 cron 重複開單 */
    currentQuoteId: uuid('current_quote_id').references(() => quotes.id, {
      onDelete: 'set null',
    }),

    /**
     * WHOIS / TLS 偵測到的到期日。刻意與 expiresAt 分開存：
     * 偵測結果不直接覆蓋人工維護的正確值，差異超過 1 天才在介面標示衝突。
     */
    detectedExpiresAt: day('detected_expires_at'),
    detectSource: detectSourceEnum('detect_source'),
    detectedAt: timestamp('detected_at', { withTimezone: true }),
    detectError: text('detect_error'),

    gcalEventId: text('gcal_event_id'),

    /** 由哪個專案轉維運建立 */
    sourceProjectId: uuid('source_project_id').references(
      (): AnyPgColumn => projects.id,
      { onDelete: 'set null' },
    ),

    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('services_site_idx').on(t.siteId),
    index('services_expires_idx').on(t.expiresAt),
    index('services_renewal_state_idx').on(t.renewalState),
    index('services_current_quote_idx').on(t.currentQuoteId),
  ],
)

/* ------------------------------------------------------------------ */
/* 報價明細（每項期間各自獨立！）                                          */
/* ------------------------------------------------------------------ */

export const quoteItems = pgTable(
  'quote_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').references(() => services.id, {
      onDelete: 'set null',
    }),
    description: text('description').notNull(),
    /** 概要／功能說明，多行。例如主機規格條列 */
    specNote: text('spec_note'),

    /**
     * 合併報價最容易出錯的地方：
     * periodStart 必須由「該項目自己的到期日」推算，不是報價單錨點日。
     * 主機 12/01 到期卻在 10/15 跟著網域一起收錢時，新期間仍從 12/02 起算，
     * 否則客戶白白被吃掉一個半月。
     *
     * 起日為到期日的「隔天」：舊期間到到期日當天為止，新期間自隔天接續，
     * 這樣兩段期間不會重疊到同一天。
     */
    periodStart: day('period_start'),
    periodEnd: day('period_end'),

    quantity: numeric('quantity', { precision: 10, scale: 2 })
      .notNull()
      .default('1'),
    unit: text('unit').notNull().default('年'),
    unitPrice: money('unit_price').notNull().default('0'),
    amount: money('amount').notNull().default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('quote_items_quote_idx').on(t.quoteId)],
)

/* ------------------------------------------------------------------ */
/* 報價單附件（回簽報價單、匯款證明）                                      */
/* ------------------------------------------------------------------ */

export const attachmentKindEnum = pgEnum('attachment_kind', [
  'signed_quote', // 客戶回簽的報價單
  'payment_proof', // 匯款證明
  'other',
])

/**
 * 檔案內容直接存在資料庫（bytea）。
 *
 * 這類檔案是收款與爭議時的憑證，最重要的是「不會不見」。存進資料庫
 * 的好處是跟客戶資料一起備份、本機與雲端行為一致，也不必為了幾十張
 * PDF 去多管一個物件儲存服務。單檔上限 10MB，以你的量體十年也不過
 * 幾百 MB，對 Postgres 完全不是問題。
 */
export const quoteAttachments = pgTable(
  'quote_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    kind: attachmentKindEnum('kind').notNull().default('signed_quote'),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    data: bytea('data').notNull(),
    /** 客戶回簽的日期，與上傳日期未必相同 */
    signedOn: day('signed_on'),
    note: text('note'),
    uploadedBy: text('uploaded_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('quote_attachments_quote_idx').on(t.quoteId)],
)

/* ------------------------------------------------------------------ */
/* 登入憑證（AES-256-GCM 加密）                                          */
/* ------------------------------------------------------------------ */

export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    label: text('label').notNull(), // WP 後台 / FTP / cPanel
    url: text('url'),
    username: text('username'),
    /** 密文、IV、authTag 分開存，authTag 用於驗證資料未被竄改 */
    secretEncrypted: text('secret_encrypted').notNull(),
    secretIv: text('secret_iv').notNull(),
    secretTag: text('secret_tag').notNull(),
    note: text('note'),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('credentials_service_idx').on(t.serviceId)],
)

/* ------------------------------------------------------------------ */
/* LINE 一次性審核 token                                                */
/* ------------------------------------------------------------------ */

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    /** 只存 sha256(token)，明文 token 僅存在於推給你的那則 LINE 訊息裡 */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedByLineUserId: text('used_by_line_user_id'),
    action: approvalActionEnum('action'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('approvals_token_hash_key').on(t.tokenHash),
    /**
     * 一張報價單同時最多只能有一個「未使用」的 token。
     * 搭配 UPDATE ... WHERE used_at IS NULL 的原子消耗，
     * 讓手滑連點兩下不可能寄出兩封信。
     */
    uniqueIndex('approvals_one_open_per_quote')
      .on(t.quoteId)
      .where(sql`used_at is null`),
  ],
)

/* ------------------------------------------------------------------ */
/* 系統設定（單列）                                                      */
/* ------------------------------------------------------------------ */

export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),

  /* ---- 乙方（我方）資訊，印在報價單上 ---- */
  companyName: text('company_name'),
  companyTaxId: text('company_tax_id'),
  companyRepresentative: text('company_representative'), // 負責人
  companyAddress: text('company_address'),
  companyPhone: text('company_phone'),
  companyEmail: text('company_email'),
  companyLineId: text('company_line_id'),
  preparedBy: text('prepared_by'), // 製表人

  /* ---- 匯款帳戶 ---- */
  bankName: text('bank_name'),
  bankCode: text('bank_code'),
  bankAccount: text('bank_account'),
  bankAccountName: text('bank_account_name'),

  /** 匯款期限警語範本，{date} 會替換成錨點到期日 */
  quotePaymentNote: text('quote_payment_note'),

  /** 錨點剩餘天數 <= 此值時擬草稿 */
  quoteTriggerDays: integer('quote_trigger_days').notNull().default(45),
  /** 納入錨點日往後這麼多天內到期的項目 */
  quoteWindowDays: integer('quote_window_days').notNull().default(60),
  /** 報價單有效天數 */
  quoteValidDays: integer('quote_valid_days').notNull().default(14),
  /** 報價單 PDF 是否自動蓋上乙方大小章（圖檔在 stamps 表） */
  stampEnabled: boolean('stamp_enabled').notNull().default(true),

  defaultTaxMode: taxModeEnum('default_tax_mode').notNull().default('exclusive'),
  defaultTaxRate: numeric('default_tax_rate', { precision: 5, scale: 4 })
    .notNull()
    .default('0.0500'),
  quoteTerms: text('quote_terms'),

  gcalCalendarId: text('gcal_calendar_id'),
  /** 「專案管理」日曆，首次同步專案時自動建立 */
  gcalProjectCalendarId: text('gcal_project_calendar_id'),

  /**
   * 報價寄送模式。false = 手動寄（後台按「寄出」）；true = LINE 確認後自動寄。
   * 新安裝預設手動寄；既有安裝由 migration 0001 設為 true，部署不改變行為（D1）。
   */
  autoSendEnabled: boolean('auto_send_enabled').notNull().default(false),
  /** 報價寄出幾天沒回覆就提醒追蹤，之後每隔同樣天數再提醒 */
  quoteFollowupDays: integer('quote_followup_days').notNull().default(7),

  /** LINE 免費方案推播額度有限，接近上限時改走 Email */
  linePushCount: integer('line_push_count').notNull().default(0),
  linePushResetAt: day('line_push_reset_at'),
  linePushMonthlyLimit: integer('line_push_monthly_limit')
    .notNull()
    .default(200),

  updatedAt: updatedAt(),
})

/* ------------------------------------------------------------------ */
/* 乙方用印（大章 = 公司章、小章 = 負責人章）                              */
/* ------------------------------------------------------------------ */

export const stampKindEnum = pgEnum('stamp_kind', ['company', 'person'])

/**
 * 用印圖檔存在資料庫，跟回簽報價單一樣隨資料庫備份、不進版控。
 * 獨立成表而不放在 settings：getSettings() 到處都在呼叫，不該每次都把圖檔讀出來。
 */
export const stamps = pgTable('stamps', {
  kind: stampKindEnum('kind').primaryKey(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  data: bytea('data').notNull(),
  uploadedBy: text('uploaded_by').notNull(),
  updatedAt: updatedAt(),
})

/* ------------------------------------------------------------------ */
/* 通知發送紀錄（防重複寄送）                                             */
/* ------------------------------------------------------------------ */

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: notifyKindEnum('kind').notNull().default('expiry'),
    /** 到期提醒用。報價追蹤、週報等為空 */
    serviceId: uuid('service_id').references(() => services.id, {
      onDelete: 'cascade',
    }),
    /** 報價追蹤、收款追蹤、草稿通知用 */
    quoteId: uuid('quote_id').references(() => quotes.id, {
      onDelete: 'cascade',
    }),
    /** 到期提醒：90 / 60 / 30 / 14 / 7 / 1，逾期為 -1（每日重複提醒）。其他種類為 0 */
    level: integer('level').notNull().default(0),
    channel: notifyChannelEnum('channel').notNull(),
    /** 逾期通知每天一則，用日期做去重鍵 */
    sentOn: day('sent_on').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    ok: boolean('ok').notNull().default(true),
    error: text('error'),
  },
  (t) => [
    /**
     * 三組部分唯一索引，依通知對象分開去重（同一件事同一天只發一次）：
     * 服務類（到期提醒）、報價類（追蹤 / 收款 / 草稿）、全域類（週報）。
     * 用部分索引是因為 NULL 在一般唯一索引裡彼此不相等，擋不住重複。
     */
    uniqueIndex('notifications_dedupe_service')
      .on(t.kind, t.serviceId, t.level, t.channel, t.sentOn)
      .where(sql`service_id is not null`),
    uniqueIndex('notifications_dedupe_quote')
      .on(t.kind, t.quoteId, t.channel, t.sentOn)
      .where(sql`quote_id is not null`),
    uniqueIndex('notifications_dedupe_global')
      .on(t.kind, t.channel, t.sentOn)
      .where(sql`service_id is null and quote_id is null`),
    index('notifications_service_idx').on(t.serviceId),
    index('notifications_quote_idx').on(t.quoteId),
  ],
)

/* ------------------------------------------------------------------ */
/* 存活監控結果                                                          */
/* ------------------------------------------------------------------ */

export const uptimeChecks = pgTable(
  'uptime_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    checkedAt: timestamp('checked_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    ok: boolean('ok').notNull(),
    statusCode: integer('status_code'),
    responseMs: integer('response_ms'),
    error: text('error'),
  },
  (t) => [index('uptime_checks_site_time_idx').on(t.siteId, t.checkedAt)],
)

/* ------------------------------------------------------------------ */
/* Google OAuth token（加密）                                           */
/* ------------------------------------------------------------------ */

export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull().default('google'),
    accountEmail: text('account_email').notNull(),
    refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
    refreshTokenIv: text('refresh_token_iv').notNull(),
    refreshTokenTag: text('refresh_token_tag').notNull(),
    scope: text('scope'),
    /**
     * 最近一次換取權杖的錯誤。
     *
     * OAuth 應用程式維持「測試中」狀態時，refresh token 只有 7 天壽命，
     * 到期後 Google 會回報 invalid_grant。這個欄位讓失效變成介面上看得見的
     * 狀態，而不是同步默默停擺沒人發現。
     */
    lastError: text('last_error'),
    lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('oauth_tokens_provider_key').on(t.provider)],
)

/* ------------------------------------------------------------------ */
/* 稽核紀錄                                                             */
/* ------------------------------------------------------------------ */

export const activityLogs = pgTable(
  'activity_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor: text('actor').notNull(), // email / 'system' / 'line:<userId>'
    action: text('action').notNull(), // quote.sent / credential.revealed ...
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    detail: jsonb('detail'),
    createdAt: createdAt(),
  },
  (t) => [index('activity_logs_created_idx').on(t.createdAt)],
)

/* ------------------------------------------------------------------ */
/* 專案（新網站製作 / 客製化外掛 / BUG 排除 / 其他）                        */
/* ------------------------------------------------------------------ */

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    /** 選填；必須屬於同一客戶 */
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    category: projectCategoryEnum('category').notNull(),
    /** 四個狀態可任意切換 */
    status: projectStatusEnum('status').notNull().default('not_started'),
    startDate: day('start_date'),
    dueDate: day('due_date'),
    description: text('description'),
    estimatedAmount: money('estimated_amount'),
    currency: text('currency').notNull().default('TWD'),
    /** 轉維運完成時間；有值後不再顯示轉維運表單 */
    handoverCompletedAt: timestamp('handover_completed_at', {
      withTimezone: true,
    }),
    /** 截止日事件（「專案管理」日曆） */
    gcalEventId: text('gcal_event_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('projects_client_idx').on(t.clientId),
    index('projects_status_due_idx').on(t.status, t.dueDate),
    index('projects_category_idx').on(t.category),
  ],
)

export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /**
     * 開始日（選填）。有值 = 一段時程（例：前端開發 11/20–12/10），
     * 日曆上是跨日事件；空 = 單日里程碑（例：設計稿確認），due_on 當天。
     */
    startOn: day('start_on'),
    /** 結束日（時程）或當天（里程碑） */
    dueOn: day('due_on').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** 每個時程 / 里程碑一個「專案管理」日曆事件；完成後事件保留 */
    gcalEventId: text('gcal_event_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('project_milestones_project_idx').on(t.projectId)],
)

/** LINE 快速新增專案的逐步問答暫存；取消、完成或過期即刪除 */
export const lineConversations = pgTable('line_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  lineUserId: text('line_user_id').notNull().unique(),
  step: lineFlowStepEnum('step').notNull(),
  /** 已選的 clientId / category / name */
  data: jsonb('data')
    .$type<{ clientId?: string; category?: string; name?: string }>()
    .notNull()
    .default({}),
  /** 最後互動 + 30 分鐘 */
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  updatedAt: updatedAt(),
})

/* ------------------------------------------------------------------ */
/* Relations                                                            */
/* ------------------------------------------------------------------ */

export const clientsRelations = relations(clients, ({ many }) => ({
  contacts: many(contacts),
  sites: many(sites),
  quotes: many(quotes),
  projects: many(projects),
}))

export const contactsRelations = relations(contacts, ({ one }) => ({
  client: one(clients, {
    fields: [contacts.clientId],
    references: [clients.id],
  }),
}))

export const sitesRelations = relations(sites, ({ one, many }) => ({
  client: one(clients, { fields: [sites.clientId], references: [clients.id] }),
  services: many(services),
  quotes: many(quotes),
  uptimeChecks: many(uptimeChecks),
  projects: many(projects),
}))

export const servicesRelations = relations(services, ({ one, many }) => ({
  site: one(sites, { fields: [services.siteId], references: [sites.id] }),
  plan: one(plans, { fields: [services.planId], references: [plans.id] }),
  currentQuote: one(quotes, {
    fields: [services.currentQuoteId],
    references: [quotes.id],
  }),
  credentials: many(credentials),
  notifications: many(notifications),
  sourceProject: one(projects, {
    fields: [services.sourceProjectId],
    references: [projects.id],
  }),
}))

export const quotesRelations = relations(quotes, ({ one, many }) => ({
  client: one(clients, { fields: [quotes.clientId], references: [clients.id] }),
  site: one(sites, { fields: [quotes.siteId], references: [sites.id] }),
  project: one(projects, {
    fields: [quotes.projectId],
    references: [projects.id],
  }),
  items: many(quoteItems),
  approvals: many(approvals),
  attachments: many(quoteAttachments),
}))

export const quoteAttachmentsRelations = relations(
  quoteAttachments,
  ({ one }) => ({
    quote: one(quotes, {
      fields: [quoteAttachments.quoteId],
      references: [quotes.id],
    }),
  }),
)

export const quoteItemsRelations = relations(quoteItems, ({ one }) => ({
  quote: one(quotes, { fields: [quoteItems.quoteId], references: [quotes.id] }),
  service: one(services, {
    fields: [quoteItems.serviceId],
    references: [services.id],
  }),
}))

export const credentialsRelations = relations(credentials, ({ one }) => ({
  service: one(services, {
    fields: [credentials.serviceId],
    references: [services.id],
  }),
}))

export const approvalsRelations = relations(approvals, ({ one }) => ({
  quote: one(quotes, { fields: [approvals.quoteId], references: [quotes.id] }),
}))

export const notificationsRelations = relations(notifications, ({ one }) => ({
  service: one(services, {
    fields: [notifications.serviceId],
    references: [services.id],
  }),
  quote: one(quotes, {
    fields: [notifications.quoteId],
    references: [quotes.id],
  }),
}))

export const projectsRelations = relations(projects, ({ one, many }) => ({
  client: one(clients, {
    fields: [projects.clientId],
    references: [clients.id],
  }),
  site: one(sites, { fields: [projects.siteId], references: [sites.id] }),
  milestones: many(projectMilestones),
  quotes: many(quotes),
}))

export const projectMilestonesRelations = relations(
  projectMilestones,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectMilestones.projectId],
      references: [projects.id],
    }),
  }),
)

export const uptimeChecksRelations = relations(uptimeChecks, ({ one }) => ({
  site: one(sites, { fields: [uptimeChecks.siteId], references: [sites.id] }),
}))

/* ------------------------------------------------------------------ */
/* Inferred types                                                       */
/* ------------------------------------------------------------------ */

export type Client = typeof clients.$inferSelect
export type NewClient = typeof clients.$inferInsert
export type Contact = typeof contacts.$inferSelect
export type NewContact = typeof contacts.$inferInsert
export type Site = typeof sites.$inferSelect
export type NewSite = typeof sites.$inferInsert
export type Service = typeof services.$inferSelect
export type NewService = typeof services.$inferInsert
export type Quote = typeof quotes.$inferSelect
export type NewQuote = typeof quotes.$inferInsert
export type QuoteItem = typeof quoteItems.$inferSelect
export type NewQuoteItem = typeof quoteItems.$inferInsert
export type Credential = typeof credentials.$inferSelect
export type Approval = typeof approvals.$inferSelect
export type QuoteAttachment = typeof quoteAttachments.$inferSelect
export type Plan = typeof plans.$inferSelect
export type NewPlan = typeof plans.$inferInsert
export type Settings = typeof settings.$inferSelect
export type Notification = typeof notifications.$inferSelect
export type UptimeCheck = typeof uptimeChecks.$inferSelect
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type ProjectMilestone = typeof projectMilestones.$inferSelect
export type LineConversation = typeof lineConversations.$inferSelect
export type Stamp = typeof stamps.$inferSelect
