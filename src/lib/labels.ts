import type {
  contactRoleEnum,
  quoteStatusEnum,
  renewalStateEnum,
  serviceStatusEnum,
  serviceTypeEnum,
  siteStatusEnum,
} from '@/db/schema'

type ServiceType = (typeof serviceTypeEnum.enumValues)[number]
type SiteStatus = (typeof siteStatusEnum.enumValues)[number]
type ContactRole = (typeof contactRoleEnum.enumValues)[number]
type RenewalState = (typeof renewalStateEnum.enumValues)[number]
type QuoteStatus = (typeof quoteStatusEnum.enumValues)[number]
type ServiceStatus = (typeof serviceStatusEnum.enumValues)[number]

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  domain: '網域',
  hosting: '主機',
  ssl: 'SSL 憑證',
  maintenance: '維護合約',
  email: '企業信箱',
  license: '外掛授權',
  cdn: 'CDN',
  other: '其他',
}

/** 到期總表上用單一字元圖示區分類型，在密集的表格裡比色塊好認 */
export const SERVICE_TYPE_ICON: Record<ServiceType, string> = {
  domain: '🌐',
  hosting: '🖥',
  ssl: '🔒',
  maintenance: '🔧',
  email: '✉',
  license: '🔑',
  cdn: '⚡',
  other: '•',
}

export const SITE_STATUS_LABEL: Record<SiteStatus, string> = {
  building: '建置中',
  live: '已上線',
  paused: '暫停',
  closed: '已結案',
}

export const CONTACT_ROLE_LABEL: Record<ContactRole, string> = {
  decision: '決策者',
  finance: '財務窗口',
  tech: '技術窗口',
  other: '其他',
}

export const SERVICE_STATUS_LABEL: Record<ServiceStatus, string> = {
  active: '使用中',
  expired: '已過期',
  cancelled: '已終止',
}

export const RENEWAL_STATE_LABEL: Record<RenewalState, string> = {
  upcoming: '未到期',
  drafted: '已擬草稿',
  pending_approval: '等你確認',
  sent: '已寄客戶',
  accepted: '客戶已同意',
  renewed: '已續約',
  declined: '客戶不續',
}

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: '草稿',
  pending_approval: '等你確認',
  sent: '已寄出',
  accepted: '已同意',
  rejected: '客戶拒絕',
  cancelled: '已取消',
  expired: '已逾期',
}

/** 服務項目的預設計費週期，建立表單自動帶入，減少輸入錯誤 */
export const DEFAULT_CYCLE_FOR_TYPE: Record<ServiceType, string> = {
  domain: 'yearly',
  hosting: 'yearly',
  ssl: 'yearly',
  maintenance: 'yearly',
  email: 'yearly',
  license: 'yearly',
  cdn: 'monthly',
  other: 'yearly',
}
