/**
 * 上傳檔案（回簽報價單、匯款證明）的檢查。
 *
 * 只接受 PDF 與常見圖片：這些檔案之後會由瀏覽器開啟，允許 HTML 或 SVG
 * 會讓上傳的檔案在同源下執行指令碼。副檔名與 MIME 都可以偽造，所以比對檔案開頭的位元組。
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp'])

const MAGIC: { type: string; bytes: number[] }[] = [
  { type: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
]

export function sniff(buffer: Buffer): string | null {
  for (const { type, bytes } of MAGIC) {
    if (bytes.every((b, i) => buffer[i] === b)) return type
  }
  // HEIC/WebP 的識別碼在位移 4 之後
  const brand = buffer.subarray(4, 12).toString('latin1')
  if (brand.startsWith('ftyphe') || brand.startsWith('ftypmif')) return 'image/heic'
  if (
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

/** 去掉路徑並限制長度，避免檔名被拿來做路徑穿越 */
export function safeName(name: string): string {
  return (
    name
      .replace(/[\\/]/g, '_')
      .replace(/[\u0000-\u001f]/g, '')
      .trim()
      .slice(0, 180) || '未命名檔案'
  )
}

export type CheckedFile = { buffer: Buffer; contentType: string; filename: string; size: number }

export async function checkUploadFile(
  file: File,
): Promise<{ ok: true; file: CheckedFile } | { ok: false; error: string }> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `檔案 ${(file.size / 1024 / 1024).toFixed(1)}MB 超過上限 10MB。掃描件請調低解析度，或改存 PDF。`,
    }
  }
  const declared = file.type || ''
  if (!ALLOWED.has(declared)) {
    return {
      ok: false,
      error: `不支援的檔案格式（${declared || '未知'}）。請上傳 PDF、JPG、PNG、HEIC 或 WebP。`,
    }
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  const actual = sniff(buffer)
  if (!actual) return { ok: false, error: '無法辨識檔案內容，請確認檔案沒有損毀' }
  if (actual !== declared) {
    return { ok: false, error: `檔案內容與宣稱的格式不符（宣稱 ${declared}，實際 ${actual}）` }
  }
  return {
    ok: true,
    file: { buffer, contentType: actual, filename: safeName(file.name), size: buffer.byteLength },
  }
}
