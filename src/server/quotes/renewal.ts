import { logActivity } from '@/lib/activity'
import {
  QuoteConflictError,
  collectQuoteGroupForSite,
  createQuoteForGroup,
} from '@/lib/quote-builder'
import { getSettings } from '@/lib/settings'
import { fail, type ActionState } from '@/server/actions/helpers'

/**
 * 管理者手動開立續約報價單。
 *
 * 與排程（/api/cron/quote-draft）共用分組與寫入邏輯，差別：
 * - 不檢查觸發天數：按下按鈕就代表現在要開。
 * - 產生後停在草稿、不推 LINE：管理者人已經在後台，直接到報價單頁寄出即可。
 */
export async function createRenewalQuote(
  siteId: string,
  actor: string,
): Promise<ActionState & { quoteId?: string }> {
  const config = await getSettings()
  const group = await collectQuoteGroupForSite(siteId, config)
  if (!group) return fail('NOT_FOUND', '找不到這個網站')

  if ('reason' in group) {
    switch (group.reason) {
      case 'mixed_currency':
        return fail(
          'MIXED_CURRENCY',
          `項目幣別不一致（${group.detail}），請先統一幣別或分開處理`,
        )
      case 'no_price':
        return fail(
          'NO_RENEWABLE_SERVICE',
          `這些項目沒有設定售價：${group.detail}。請先填售價`,
        )
      case 'zero_total':
        return fail('NO_RENEWABLE_SERVICE', '項目金額合計為 0，沒有可收費的內容')
      default:
        return fail(
          'NO_RENEWABLE_SERVICE',
          '沒有可續約的項目（項目都已在其他報價單中，或不是我方代管）',
        )
    }
  }

  try {
    const quote = await createQuoteForGroup(group, config)
    await logActivity(actor, 'quote.renewal_manual', 'quote', quote.id, {
      quoteNo: quote.quoteNo,
      siteId,
      items: quote.itemCount,
    })
    return { ok: true, quoteId: quote.id }
  } catch (error) {
    if (error instanceof QuoteConflictError) {
      return fail('NO_RENEWABLE_SERVICE', `${error.message}，請重新整理頁面`)
    }
    throw error
  }
}
