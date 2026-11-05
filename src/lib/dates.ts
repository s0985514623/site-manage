import { addDays, addMonths, differenceInCalendarDays, parseISO } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'

import type { billingCycleEnum } from '@/db/schema'

/**
 * 時區常數定義在這裡而不是 env.ts。
 *
 * 這個模組會被 client component 一路 import 進去（ui.tsx → action-form.tsx），
 * 若從 env.ts 取常數，整份伺服器環境變數驗證也會被打包進客戶端，
 * 然後在瀏覽器裡因為讀不到 DATABASE_URL 而整頁崩潰。
 */
export const TIMEZONE = 'Asia/Taipei'

/**
 * 到期日一律用 'YYYY-MM-DD' 字串處理，不用 Date 物件在系統間傳遞。
 *
 * 原因：伺服器跑在 UTC、你人在台北。若用 timestamp 相減，
 * 台北時間 2026-10-15 08:00 的「今天」在 UTC 還是 10-14，
 * 剩餘天數就會差一天 —— 而差一天足以讓網域過期。
 */

export type DateStr = string // 'YYYY-MM-DD'
export type BillingCycle = (typeof billingCycleEnum.enumValues)[number]

/** 台北時區的「今天」 */
export function today(): DateStr {
  return formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd')
}

/**
 * 距離目標日還有幾天（以日曆日計算）。
 * 正數 = 還沒到期，0 = 今天到期，負數 = 已逾期。
 */
export function daysUntil(target: DateStr, from: DateStr = today()): number {
  return differenceInCalendarDays(parseISO(target), parseISO(from))
}

export function plusDays(date: DateStr, days: number): DateStr {
  return formatDate(addDays(parseISO(date), days))
}

const CYCLE_MONTHS: Record<BillingCycle, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
  biennial: 24,
  triennial: 36,
}

export const CYCLE_LABEL: Record<BillingCycle, string> = {
  monthly: '每月',
  quarterly: '每季',
  yearly: '每年',
  biennial: '每兩年',
  triennial: '每三年',
}

/**
 * 依計費週期推進到期日。
 *
 * 採註冊商慣例：2026-10-15 到期、續約一年 → 新到期日 2027-10-15。
 * 因此報價單上的服務期間（period_start ~ period_end）的結束日，
 * 正好等於續約後的新到期日，兩邊定義一致不會對不上。
 */
export function advanceByCycle(date: DateStr, cycle: BillingCycle): DateStr {
  return formatDate(addMonths(parseISO(date), CYCLE_MONTHS[cycle]))
}

export function formatDate(date: Date): DateStr {
  return formatInTimeZone(date, TIMEZONE, 'yyyy-MM-dd')
}

/**
 * 續約後新服務期間的起日 = 到期日的「隔天」。
 *
 * 舊期間到到期日當天為止，新期間自隔天接續，兩段不會重疊到同一天。
 * 例：2026/10/15 到期 → 新期間 2026/10/16 ~ 2027/10/15。
 * 這是你現有報價單的寫法，維持一致客戶才不會覺得對不上。
 */
export function renewalPeriodStart(expiresAt: DateStr): DateStr {
  return plusDays(expiresAt, 1)
}

/** 計費週期對應的報價單「單位」欄文字 */
export const CYCLE_UNIT: Record<BillingCycle, string> = {
  monthly: '月',
  quarterly: '季',
  yearly: '年',
  biennial: '2年',
  triennial: '3年',
}

/** 顯示用：2026/10/15 */
export function formatTw(date: DateStr): string {
  return date.replaceAll('-', '/')
}

/**
 * 服務期間字串：2026/10/16 至 2027/10/15
 * 用「至」而非「~」，與現有報價單的寫法一致。
 */
export function formatPeriod(start: DateStr, end: DateStr): string {
  return `${formatTw(start)} 至 ${formatTw(end)}`
}

/**
 * 提醒門檻。逾期用 -1 表示，且每天都會再提醒一次。
 *
 * 必須包含 0：「今天到期」是最該提醒的一天。若只設 1 天前就不管，
 * 當天不會有任何通知，要等隔天變成逾期才發現——而網域當天就會停止解析。
 */
export const NOTICE_LEVELS = [90, 60, 30, 14, 7, 1, 0] as const
export const OVERDUE_LEVEL = -1

/**
 * 判斷某個剩餘天數應該觸發哪一段提醒。
 * 回傳 null 代表今天不需要提醒這個項目。
 */
export function noticeLevelFor(days: number): number | null {
  if (days < 0) return OVERDUE_LEVEL
  return NOTICE_LEVELS.includes(days as (typeof NOTICE_LEVELS)[number])
    ? days
    : null
}

/** 到期急迫度，用於介面紅黃綠標示與通知分區 */
export type Urgency = 'overdue' | 'critical' | 'warning' | 'upcoming' | 'safe'

export function urgencyOf(days: number): Urgency {
  if (days < 0) return 'overdue'
  if (days <= 14) return 'critical'
  if (days <= 30) return 'warning'
  if (days <= 90) return 'upcoming'
  return 'safe'
}

export const URGENCY_LABEL: Record<Urgency, string> = {
  overdue: '已逾期',
  critical: '14 天內',
  warning: '30 天內',
  upcoming: '90 天內',
  safe: '安全',
}

/**
 * 剩餘天數的中文描述。
 * 逾期特別標示天數，因為 .com 過期後 30 天寬限期、再 30 天贖回期，
 * 贖回費用極高，逾期幾天是關鍵資訊。
 */
export function describeDays(days: number): string {
  if (days < 0) return `已逾期 ${Math.abs(days)} 天`
  if (days === 0) return '今天到期'
  return `剩 ${days} 天`
}
