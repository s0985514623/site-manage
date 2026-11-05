import 'server-only'

import { z } from 'zod'

/**
 * 環境變數驗證。
 *
 * 最上面的 `import 'server-only'` 是刻意的防線：這個模組一旦被 client
 * component 的 import 鏈拉進客戶端打包，瀏覽器會因為讀不到 DATABASE_URL
 * 而整頁崩潰。有了它，這類錯誤會在「建置階段」就以清楚的訊息失敗，
 * 而不是等到使用者點開某個頁面才炸。
 *
 * 分成「核心」與「整合」兩層：核心缺少就直接讓程式起不來（寧可開不起來，
 * 也不要跑到一半才發現 ENCRYPTION_KEY 是空的）；整合（LINE / Resend /
 * Google）缺少時只讓對應功能停用，不影響其他部分，方便分階段接上。
 */

const base64Key32 = z
  .string()
  .min(1, '不可為空')
  .refine((v) => {
    try {
      return Buffer.from(v, 'base64').length === 32
    } catch {
      return false
    }
  }, '必須是 32 bytes 的 base64 字串（產生方式：openssl rand -base64 32）')

const coreSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default('http://localhost:3000'),
  AUTH_SECRET: z.string().min(16),
  ENCRYPTION_KEY: base64Key32,
  CRON_SECRET: z.string().min(16),
  ALLOWED_EMAILS: z.string().default(''),
  AUTH_GOOGLE_ID: z.string().default(''),
  AUTH_GOOGLE_SECRET: z.string().default(''),
})

const integrationSchema = z.object({
  RESEND_API_KEY: z.string().default(''),
  MAIL_FROM: z.string().default(''),
  NOTIFY_TO: z.string().default(''),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().default(''),
  LINE_CHANNEL_SECRET: z.string().default(''),
  LINE_ADMIN_USER_ID: z.string().default(''),
})

function load() {
  const parsed = coreSchema.merge(integrationSchema).safeParse(process.env)

  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.')}: ${i.message}`,
    )
    throw new Error(
      `環境變數設定有誤，請檢查 .env.local（可參考 .env.example）：\n${lines.join('\n')}`,
    )
  }

  return parsed.data
}

export const env = load()

/** 允許登入的 Email 白名單 */
export const allowedEmails = env.ALLOWED_EMAILS.split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

/** 各項整合是否已設定完成，未設定的功能會優雅降級而非拋錯 */
export const features = {
  googleLogin: Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET),
  email: Boolean(env.RESEND_API_KEY && env.MAIL_FROM),
  line: Boolean(env.LINE_CHANNEL_ACCESS_TOKEN && env.LINE_CHANNEL_SECRET),
  /** 只有設定了管理者 userId 才允許用 LINE 批准寄信給客戶 */
  lineApproval: Boolean(
    env.LINE_CHANNEL_ACCESS_TOKEN &&
      env.LINE_CHANNEL_SECRET &&
      env.LINE_ADMIN_USER_ID,
  ),
} as const
