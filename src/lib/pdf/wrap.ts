import path from 'node:path'

import { openSync } from 'fontkit'

/**
 * 以真實字型度量替中文預先斷行。
 *
 * 為什麼不交給 react-pdf 自動換行：
 * textkit 以「空白」切詞，中文整句會被當成單一個詞而無法換行，直接溢出欄位。
 * 若改用 hyphenationCallback 提供斷點，textkit 會在斷點插入連字號
 * （原始碼寫死 HYPHEN = 0x002d，沒有關閉選項），中文句子中間冒出 `-`
 * 在客戶看到的報價單上像是打錯字。
 *
 * 所以在這裡自己量測字寬並插入換行，讓 react-pdf 永遠不需要自行斷詞。
 */

const FONT_DIR = path.join(process.cwd(), 'public', 'fonts')

// openSync 的回傳型別涵蓋 FontCollection（.ttc），但我們用的是單一 .ttf
type Font = Extract<ReturnType<typeof openSync>, { unitsPerEm: number }>

const cache = new Map<string, Font>()

function font(bold: boolean): Font {
  const key = bold ? 'Bold' : 'Regular'
  let f = cache.get(key)
  if (!f) {
    f = openSync(path.join(FONT_DIR, `NotoSansTC-${key}.ttf`)) as Font
    cache.set(key, f)
  }
  return f
}

/** 單行文字在指定字級下的寬度（pt） */
export function measure(text: string, fontSize: number, bold = false): number {
  if (!text) return 0
  const f = font(bold)
  // fontkit 的 advanceWidth 以 1000 unitsPerEm 為基準回報 layout 寬度
  const run = f.layout(text)
  return (run.advanceWidth / f.unitsPerEm) * fontSize
}

/** 不可出現在行首的字元（簡化版禁則處理） */
const NO_BREAK_BEFORE = /[、。，．！？；：·…〕）］｝」』〉》〞’”%,.!?;:)\]}]/
/** 不可出現在行尾的字元 */
const NO_BREAK_AFTER = /[〔（［｛「『〈《〝‘“(\[{]/

/**
 * 把文字折成不超過 maxWidth 的多行。
 *
 * 英數字詞會整段保留不切開；中文可在任意字之間換行，但避開禁則字元。
 * 已存在的換行符會被保留。
 */
export function wrapText(
  text: string | null | undefined,
  maxWidth: number,
  fontSize: number,
  bold = false,
): string {
  if (!text) return ''
  if (maxWidth <= 0) return text

  return text
    .split('\n')
    .map((line) => wrapLine(line, maxWidth, fontSize, bold))
    .join('\n')
}

function wrapLine(
  line: string,
  maxWidth: number,
  fontSize: number,
  bold: boolean,
): string {
  if (measure(line, fontSize, bold) <= maxWidth) return line

  // 先切成「不可分割的單元」：連續英數視為一體，中文逐字
  const units: string[] = []
  let latin = ''
  for (const ch of line) {
    if (/[A-Za-z0-9@._\-/+:#%$]/.test(ch)) {
      latin += ch
    } else {
      if (latin) {
        units.push(latin)
        latin = ''
      }
      units.push(ch)
    }
  }
  if (latin) units.push(latin)

  const out: string[] = []
  let current = ''

  for (let i = 0; i < units.length; i++) {
    const unit = units[i]
    const candidate = current + unit

    if (measure(candidate, fontSize, bold) <= maxWidth || current === '') {
      current = candidate
      continue
    }

    // 需要換行。避免把收尾標點推到下一行行首
    let carry = ''
    if (NO_BREAK_BEFORE.test(unit) && current.length > 1) {
      // 這個標點跟著上一行走，改把上一行最後一字帶下來
      carry = current.slice(-1)
      current = current.slice(0, -1)
    }
    // 避免行尾停在開啟括號
    while (current.length > 1 && NO_BREAK_AFTER.test(current.slice(-1))) {
      carry = current.slice(-1) + carry
      current = current.slice(0, -1)
    }

    out.push(current)
    current = carry + unit
  }

  if (current) out.push(current)
  return out.join('\n')
}
