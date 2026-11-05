/**
 * PDF 的中文斷行規則。
 *
 * react-pdf 以「空白」切詞，而中文句子沒有空白，整段會被當成單一個詞。
 * 若不提供斷點，長句就無法換行，會直接超出欄位被裁掉 —— 而且不會報錯，
 * 只有真的把 PDF 打開才看得見，那時信通常已經寄出去了。
 *
 * 這裡的規則：
 *   1. 純英數的詞維持完整，不從中間切斷
 *   2. 中文可在任意字之間換行
 *   3. 但不在「收尾標點」之前斷行，避免出現行首是「。」或「」」的情形
 */

/** CJK 漢字、標點、全形字元 */
const CJK =
  /[㐀-鿿豈-﫿　-〿＀-￯㇀-㇯]/

/** 不可出現在行首的字元（中文排版的禁則處理，簡化版） */
const NO_BREAK_BEFORE = /[、。，．！？；：·…〕）］｝」』〉》〞’”%,.!?;:)\]}]/

export function cjkHyphenation(word: string): string[] {
  if (!CJK.test(word)) return [word]

  const parts: string[] = []
  let current = ''

  for (let i = 0; i < word.length; i++) {
    current += word[i]
    const next = word[i + 1]
    // 只在「目前字元是中日韓字」且「下一字不是收尾標點」時提供斷點
    if (next && CJK.test(word[i]) && !NO_BREAK_BEFORE.test(next)) {
      parts.push(current)
      current = ''
    }
  }
  if (current) parts.push(current)

  return parts
}
