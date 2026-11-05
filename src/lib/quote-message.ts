import { asc, eq } from 'drizzle-orm'

import { db } from '@/db'
import { quoteItems, quotes } from '@/db/schema'
import { formatPeriod, formatTw } from './dates'
import { env } from './env'
import type { LineMessage } from './line'
import { formatMoney } from './money'

/**
 * 推給你確認的報價單 Flex Message。
 *
 * 設計原則：你會在手機上、可能正在忙的時候看到這則訊息就按下確認，
 * 所以**必須在按鈕正上方明確列出收件人 Email**。
 * 寄錯客戶比寄晚更難收拾。
 */

const COLORS = {
  text: '#14181f',
  muted: '#667085',
  accent: '#1f6feb',
  warn: '#b54708',
  line: '#e4e7ec',
}

function row(label: string, value: string, valueColor = COLORS.text) {
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: COLORS.muted, flex: 2 },
      {
        type: 'text',
        text: value,
        size: 'sm',
        color: valueColor,
        flex: 5,
        wrap: true,
      },
    ],
  }
}

export async function buildApprovalMessage(
  quoteId: string,
  token: string,
  recipients: string[],
): Promise<LineMessage> {
  const quote = await db.query.quotes.findFirst({
    where: eq(quotes.id, quoteId),
    with: {
      client: true,
      site: true,
      items: { orderBy: [asc(quoteItems.sortOrder)] },
    },
  })
  if (!quote) throw new Error(`找不到報價單 ${quoteId}`)

  const itemBlocks = quote.items.map((item) => ({
    type: 'box',
    layout: 'vertical',
    margin: 'md',
    contents: [
      {
        type: 'box',
        layout: 'baseline',
        contents: [
          {
            type: 'text',
            text: item.description.split('（')[0],
            size: 'sm',
            weight: 'bold',
            color: COLORS.text,
            flex: 5,
            wrap: true,
          },
          {
            type: 'text',
            text: formatMoney(item.amount, quote.currency),
            size: 'sm',
            align: 'end',
            color: COLORS.text,
            flex: 3,
          },
        ],
      },
      {
        // 期間是這則訊息最該被看清楚的資訊：確認每項都從自己的到期日起算
        type: 'text',
        text:
          item.periodStart && item.periodEnd
            ? `服務期間 ${formatPeriod(item.periodStart, item.periodEnd)}`
            : '',
        size: 'xxs',
        color: COLORS.muted,
        margin: 'xs',
      },
    ],
  }))

  return {
    type: 'flex',
    altText: `[報價確認] ${quote.client.name} · ${quote.site.name} ${formatMoney(quote.total, quote.currency)}`,
    contents: {
      type: 'bubble',
      size: 'giga',
      header: {
        type: 'box',
        layout: 'vertical',
        paddingAll: 'lg',
        backgroundColor: '#f6f7f9',
        contents: [
          {
            type: 'text',
            text: '報價單待確認',
            weight: 'bold',
            size: 'lg',
            color: COLORS.text,
          },
          {
            type: 'text',
            text: quote.quoteNo,
            size: 'xs',
            color: COLORS.muted,
            margin: 'xs',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: 'lg',
        contents: [
          row('客戶', quote.client.name),
          row('網站', quote.site.name),
          row('有效至', formatTw(quote.validUntil)),

          { type: 'separator', margin: 'lg', color: COLORS.line },
          {
            type: 'text',
            text: `續約項目（${quote.items.length}）`,
            size: 'xs',
            color: COLORS.muted,
            margin: 'lg',
          },
          ...itemBlocks,

          { type: 'separator', margin: 'lg', color: COLORS.line },
          {
            type: 'box',
            layout: 'baseline',
            margin: 'lg',
            contents: [
              {
                type: 'text',
                text: quote.taxMode === 'exclusive' ? '含稅合計' : '合計',
                size: 'sm',
                weight: 'bold',
                color: COLORS.text,
                flex: 4,
              },
              {
                type: 'text',
                text: formatMoney(quote.total, quote.currency),
                size: 'lg',
                weight: 'bold',
                align: 'end',
                color: COLORS.text,
                flex: 5,
              },
            ],
          },

          { type: 'separator', margin: 'lg', color: COLORS.line },
          {
            type: 'text',
            text: '按下確認後會立即寄給',
            size: 'xs',
            color: COLORS.muted,
            margin: 'lg',
          },
          ...recipients.map((email) => ({
            type: 'text',
            text: `· ${email}`,
            size: 'sm',
            weight: 'bold',
            color: COLORS.warn,
            wrap: true,
            margin: 'xs',
          })),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: 'lg',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: COLORS.accent,
            height: 'sm',
            action: {
              type: 'postback',
              label: '確認寄出',
              data: `act=approve&t=${token}`,
              // 按下後在聊天室留下紀錄，日後回查是誰在什麼時候批准的
              displayText: `確認寄出 ${quote.quoteNo}`,
            },
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: {
              type: 'uri',
              label: '我要修改',
              uri: `${env.APP_URL}/quotes/${quote.id}`,
            },
          },
          {
            type: 'button',
            style: 'link',
            height: 'sm',
            action: {
              type: 'postback',
              label: '取消這張報價單',
              data: `act=reject&t=${token}`,
              displayText: `取消 ${quote.quoteNo}`,
            },
          },
        ],
      },
    },
  }
}
