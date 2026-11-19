import { describe, expect, it } from 'vitest'

import { describeSchedule, nextRunAfter } from '@/lib/schedule'

const at = (value: string) => new Date(`${value.replace(' ', 'T')}:00+08:00`)

describe('nextRunAfter 邊界', () => {
  it.each([
    ['間隔跨午夜', { frequency: 'interval', intervalMinutes: 15 }, '2026-11-16 23:50', '2026-11-17 00:00'],
    ['間隔剛好在整點時跳下一格', { frequency: 'interval', intervalMinutes: 60 }, '2026-11-16 10:00', '2026-11-16 11:00'],
    ['每天：時間還沒到就是今天', { frequency: 'daily', timeOfDay: '23:59' }, '2026-11-16 10:00', '2026-11-16 23:59'],
    ['每週：今天就是該星期但時間已過 → 下週', { frequency: 'weekly', weekday: 1, timeOfDay: '09:00' }, '2026-11-16 10:00', '2026-11-23 09:00'],
    ['每週：今天就是該星期且時間未到 → 今天', { frequency: 'weekly', weekday: 1, timeOfDay: '11:00' }, '2026-11-16 10:00', '2026-11-16 11:00'],
    ['每月：跨年', { frequency: 'monthly', dayOfMonth: 5, timeOfDay: '09:00' }, '2026-12-06 10:00', '2027-01-05 09:00'],
    ['每月 31 號：4 月改 30 號', { frequency: 'monthly', dayOfMonth: 31, timeOfDay: '09:00' }, '2027-04-01 10:00', '2027-04-30 09:00'],
    ['每月 29 號：閏年 2 月有 29 號', { frequency: 'monthly', dayOfMonth: 29, timeOfDay: '09:00' }, '2028-02-01 10:00', '2028-02-29 09:00'],
  ] as const)('%s', (_name, schedule, after, expected) => {
    expect(nextRunAfter(schedule, at(after))).toEqual(at(expected))
  })

  it('參數不完整時回傳 null', () => {
    expect(nextRunAfter({ frequency: 'interval', intervalMinutes: 7 }, new Date())).toBeNull()
    expect(nextRunAfter({ frequency: 'daily', timeOfDay: '9:00' }, new Date())).toBeNull()
  })

  it('顯示文字', () => {
    expect(describeSchedule({ frequency: 'interval', intervalMinutes: 120 })).toBe('每 2 小時')
    expect(describeSchedule({ frequency: 'weekly', weekday: 1, timeOfDay: '08:00' })).toBe('每週一 08:00')
  })
})
