import { vi } from 'vitest'

/**
 * 固定「今天」。預設台北時間上午 10:00（規格的共同前提）。
 *
 * 只假 Date（R5）：postgres 連線靠 setTimeout 等計時器，全部假掉會卡住。
 * 業務判斷一律用 today() / JS Date 算好再傳進 SQL，不在查詢條件用 now()。
 */
export function 今天是(date: string, time = '10:00') {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${date}T${time}:00+08:00`))
}

export function 恢復時鐘() {
  vi.useRealTimers()
}
