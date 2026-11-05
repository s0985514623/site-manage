import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

import { env } from './env'

/**
 * AES-256-GCM 對稱加密，用於主機/FTP/WP 帳密、網域 EPP Auth Code、
 * 以及 Google OAuth refresh token。
 *
 * 選 GCM 而非 CBC 的原因：GCM 是 AEAD，除了保密還附帶完整性驗證。
 * 若資料庫內容被竄改，解密會直接失敗而不是悄悄吐出錯誤的明文。
 *
 * ⚠️ ENCRYPTION_KEY 遺失 = 所有密文永久無法還原。
 */

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // GCM 建議 96 bits

let cachedKey: Buffer | null = null

function key(): Buffer {
  if (!cachedKey) {
    cachedKey = Buffer.from(env.ENCRYPTION_KEY, 'base64')
    if (cachedKey.length !== 32) {
      throw new Error('ENCRYPTION_KEY 必須是 32 bytes 的 base64 字串')
    }
  }
  return cachedKey
}

export type Encrypted = {
  /** base64 密文 */
  ciphertext: string
  /** base64 初始化向量，每筆獨立 */
  iv: string
  /** base64 認證標籤，用於驗證資料未被竄改 */
  tag: string
}

export function encrypt(plaintext: string): Encrypted {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}

export function decrypt(data: Encrypted): string {
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key(),
      Buffer.from(data.iv, 'base64'),
    )
    decipher.setAuthTag(Buffer.from(data.tag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(data.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch (cause) {
    // 刻意不靜默失敗：解密不出來通常代表換過金鑰或資料被動過，
    // 這是必須讓人看見的嚴重狀況。
    throw new Error(
      '解密失敗。可能原因：ENCRYPTION_KEY 已更換、或密文遭竄改。' +
        '若金鑰確實遺失，此筆資料無法復原。',
      { cause },
    )
  }
}

/** 給 LINE 審核 token 用：資料庫只存雜湊，明文僅存在於推播訊息裡 */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** 產生 URL 安全的隨機 token */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/**
 * 定時比較，避免以回應時間推測 secret。
 * 用於 CRON_SECRET 等固定長度祕密的比對。
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
