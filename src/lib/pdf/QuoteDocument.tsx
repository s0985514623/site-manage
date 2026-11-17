import path from 'node:path'

import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'

import { formatTw } from '../dates'
import { formatAmount } from '../money'
import type { Quote, QuoteItem, Client, Settings } from '@/db/schema'
import { cjkHyphenation } from './hyphenation'
import { wrapText } from './wrap'

/**
 * 報價單 PDF，版面依照現有的「九如基金會主機報價單」範本還原：
 *
 *   報價單標題
 *   ├ 左：專案名稱／報價日期／單位名稱／聯絡人／電話／Email／LINE
 *   └ 右：報價單號／有效期限／報價單位／製表人／電話／Email／LINE
 *   明細表：No.｜名稱｜概要／功能說明｜單價｜數量｜單位｜金額
 *   右下：稅率／小計／稅額／總額(含稅)
 *   付款方式（含匯款帳號）｜交付方式（含匯款期限警語）
 *   甲方／乙方對照（公司名稱、統編、負責人、地址、電話、用印）
 *   備註條款
 */

const FONT_DIR = path.join(process.cwd(), 'public', 'fonts')
let registered = false

function registerFonts() {
  if (registered) return
  Font.register({
    family: 'NotoSansTC',
    fonts: [
      { src: path.join(FONT_DIR, 'NotoSansTC-Regular.ttf'), fontWeight: 400 },
      { src: path.join(FONT_DIR, 'NotoSansTC-Bold.ttf'), fontWeight: 700 },
    ],
  })
  // 中文可在任意字之間換行，英數詞維持完整。缺了這個長中文句會溢出欄位
  Font.registerHyphenationCallback(cjkHyphenation)
  registered = true
}

/**
 * 版面寬度常數。
 *
 * 中文要靠 wrapText 預先斷行（見 ./wrap.ts），而斷行需要知道每個欄位
 * 的可用寬度，所以這裡把寬度算出來，與下方 StyleSheet 的設定一致。
 * 改動欄寬時兩邊要一起改。
 */
const A4_WIDTH = 595.28
const PAGE_PADDING = 26
const CONTENT = A4_WIDTH - PAGE_PADDING * 2 // 543.28

/**
 * 各欄位可用的文字寬度。
 *
 * 標籤與值都有自己的左右內距，都要扣掉；另外留 3pt 安全邊界，
 * 因為 Yoga 對 width 是否含內距的處理與 CSS 不完全一致。
 * 估寬只要多出一個字，react-pdf 就會自行再斷一次並補上連字號。
 */
const SAFETY = 3
/** 上方資訊區：半欄扣 paddingRight 10、標籤(58+4×2)、值內距 5×2 */
const INFO_VALUE_W = CONTENT / 2 - 10 - (58 + 8) - 10 - SAFETY
/** 區塊 key-value：半欄扣標籤(58+5×2)、值內距 5×2 */
const KV_VALUE_W = CONTENT / 2 - (58 + 10) - 10 - SAFETY
/** 明細表概要說明欄：38% 扣左右內距 4×2 */
const SPEC_W = CONTENT * 0.38 - 8 - SAFETY
/** 備註區：整頁寬扣左右內距 5×2 */
const TERMS_W = CONTENT - 10 - SAFETY

const C = {
  text: '#000000',
  muted: '#595959',
  line: '#000000',
  soft: '#bfbfbf',
  head: '#d9d9d9',
  band: '#f2f2f2',
}

const s = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansTC',
    fontSize: 8,
    color: C.text,
    paddingTop: 20,
    paddingBottom: 26,
    paddingHorizontal: 26,
    lineHeight: 1.4,
  },

  title: {
    fontSize: 17,
    fontWeight: 700,
    textAlign: 'center',
    letterSpacing: 6,
    /**
     * 中文字會填滿整個 em 框，而 borderBottom 畫在內距的外緣。
     * paddingBottom 小於 10 時橫線會從字底穿過去，實測 12 才有乾淨間距。
     * lineHeight 收緊到 1.15 補回因此多佔的高度，維持單頁。
     */
    lineHeight: 1.15,
    paddingBottom: 12,
    marginBottom: 7,
    borderBottomWidth: 1.5,
    borderBottomColor: C.line,
  },

  /* 上方資訊區：左右各一欄，每列「標籤 + 值」 */
  infoWrap: { flexDirection: 'row', marginBottom: 8 },
  infoCol: { width: '50%', paddingRight: 10 },
  infoRow: { flexDirection: 'row', paddingVertical: 1.5 },
  infoLabel: {
    width: 58,
    color: C.muted,
    backgroundColor: C.band,
    paddingVertical: 1.5,
    paddingHorizontal: 4,
  },
  infoValue: { flex: 1, paddingVertical: 1.5, paddingHorizontal: 5 },
  infoValueBold: { fontWeight: 700 },

  /* 明細表 */
  th: {
    flexDirection: 'row',
    backgroundColor: C.head,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.line,
    paddingVertical: 4,
  },
  thText: { fontWeight: 700, fontSize: 8 },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: C.soft,
    paddingVertical: 4.5,
    minHeight: 19,
  },
  cNo: { width: '5%', paddingHorizontal: 3, textAlign: 'center' },
  cName: { width: '19%', paddingHorizontal: 4 },
  cSpec: { width: '38%', paddingHorizontal: 4 },
  cPrice: { width: '12%', paddingHorizontal: 4, textAlign: 'right' },
  cQty: { width: '7%', paddingHorizontal: 3, textAlign: 'center' },
  cUnit: { width: '6%', paddingHorizontal: 3, textAlign: 'center' },
  cAmt: { width: '13%', paddingHorizontal: 4, textAlign: 'right' },

  itemName: { fontWeight: 700 },
  spec: { fontSize: 7, color: C.muted, lineHeight: 1.5 },

  /* 合計區：靠右四列 */
  totals: { alignItems: 'flex-end', marginTop: 6 },
  totalRow: { flexDirection: 'row', width: 210 },
  totalLabel: {
    width: 95,
    paddingVertical: 2.5,
    paddingHorizontal: 5,
    textAlign: 'right',
    color: C.muted,
    backgroundColor: C.band,
  },
  totalValue: {
    width: 115,
    paddingVertical: 2.5,
    paddingHorizontal: 6,
    textAlign: 'right',
    borderBottomWidth: 0.5,
    borderBottomColor: C.soft,
  },
  grandLabel: { fontWeight: 700, color: C.text },
  grandValue: { fontWeight: 700, fontSize: 10 },

  /* 區塊標頭（付款方式／交付方式／甲方／乙方／備註） */
  sectionWrap: { flexDirection: 'row', marginTop: 8 },
  sectionCol: { width: '50%' },
  sectionHead: {
    backgroundColor: C.head,
    borderTopWidth: 1,
    borderColor: C.line,
    paddingVertical: 3,
    paddingHorizontal: 5,
    fontWeight: 700,
  },
  kvRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: C.soft,
  },
  kvLabel: {
    width: 58,
    paddingVertical: 2.5,
    paddingHorizontal: 5,
    color: C.muted,
    backgroundColor: C.band,
  },
  kvValue: { flex: 1, paddingVertical: 2.5, paddingHorizontal: 5 },

  /* 用印欄：甲乙方同高（72pt），甲方留白給客戶蓋，乙方放大小章 */
  stampBox: { height: 72 },
  /* 乙方用印：大章在左、小章在右，固定尺寸、維持比例 */
  stampFilled: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stampCompany: { width: 66, height: 66, objectFit: 'contain' },
  stampPerson: { width: 34, height: 34, objectFit: 'contain' },

  termsHead: {
    backgroundColor: C.head,
    borderTopWidth: 1,
    borderColor: C.line,
    paddingVertical: 3,
    paddingHorizontal: 5,
    fontWeight: 700,
    marginTop: 8,
  },
  termsBody: {
    fontSize: 6.8,
    color: C.text,
    lineHeight: 1.5,
    paddingVertical: 4,
    paddingHorizontal: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: C.soft,
  },

  footer: {
    position: 'absolute',
    bottom: 12,
    left: 26,
    right: 26,
    fontSize: 6.8,
    color: C.muted,
    textAlign: 'center',
  },
})

function InfoRow({
  label,
  value,
  bold,
}: {
  label: string
  value?: string | null
  bold?: boolean
}) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={[s.infoValue, ...(bold ? [s.infoValueBold] : [])]}>
        {wrapText(value, INFO_VALUE_W, 8, bold)}
      </Text>
    </View>
  )
}

function KV({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={s.kvRow}>
      <Text style={s.kvLabel}>{label}</Text>
      <Text style={s.kvValue}>{wrapText(value, KV_VALUE_W, 8)}</Text>
    </View>
  )
}

export type QuoteDocumentProps = {
  quote: Quote & { items: QuoteItem[]; client: Client; siteName: string }
  settings: Settings
  /** 甲方聯絡人（主要窗口） */
  contact?: { name?: string | null; phone?: string | null; email?: string | null }
  /** 乙方用印（data URI）。沒有就留白給人手動蓋 */
  stamps?: { company?: string; person?: string }
}

export function QuoteDocument({ quote, settings, contact, stamps }: QuoteDocumentProps) {
  registerFonts()
  const taxPercent = Number(quote.taxRate) * 100
  const cur = quote.currency

  const bank = [
    settings.bankName && `銀行: ${settings.bankName}`,
    settings.bankCode && `銀行代號: ${settings.bankCode}`,
    settings.bankAccount && `帳號: ${settings.bankAccount}`,
    settings.bankAccountName && `戶名: ${settings.bankAccountName}`,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <Document
      title={`報價單 ${quote.quoteNo}`}
      author={settings.companyName ?? ''}
    >
      <Page size="A4" style={s.page}>
        <Text style={s.title}>報價單</Text>

        {/* 上方資訊區 */}
        <View style={s.infoWrap}>
          <View style={s.infoCol}>
            <InfoRow label="專案名稱" value={quote.projectName} bold />
            <InfoRow label="報價日期" value={quote.issueDate} />
            <InfoRow label="單位名稱" value={quote.client.name} bold />
            <InfoRow label="聯絡人" value={contact?.name} />
            <InfoRow label="聯絡電話" value={contact?.phone ?? quote.client.phone} />
            <InfoRow label="Email" value={contact?.email} />
          </View>
          <View style={s.infoCol}>
            <InfoRow label="報價單號" value={quote.quoteNo} bold />
            <InfoRow label="報價有效期限" value={quote.validUntil} bold />
            <InfoRow label="報價單位" value={settings.companyName} />
            <InfoRow label="製表人" value={settings.preparedBy} />
            <InfoRow label="聯絡電話" value={settings.companyPhone} />
            <InfoRow label="Email" value={settings.companyEmail} />
            <InfoRow label="LINE" value={settings.companyLineId} />
          </View>
        </View>

        {/* 明細表 */}
        <View style={s.th}>
          <Text style={[s.cNo, s.thText]}>No.</Text>
          <Text style={[s.cName, s.thText]}>名稱</Text>
          <Text style={[s.cSpec, s.thText]}>概要／功能說明</Text>
          <Text style={[s.cPrice, s.thText]}>單價</Text>
          <Text style={[s.cQty, s.thText]}>數量</Text>
          <Text style={[s.cUnit, s.thText]}>單位</Text>
          <Text style={[s.cAmt, s.thText]}>金額</Text>
        </View>

        {quote.items.map((item, i) => (
          <View key={item.id} style={s.tr} wrap={false}>
            <Text style={s.cNo}>{i + 1}</Text>
            <Text style={[s.cName, s.itemName]}>{item.description}</Text>
            <Text style={[s.cSpec, s.spec]}>
              {wrapText(item.specNote, SPEC_W, 7)}
            </Text>
            <Text style={s.cPrice}>{formatAmount(item.unitPrice, cur)}</Text>
            <Text style={s.cQty}>{Number(item.quantity)}</Text>
            <Text style={s.cUnit}>{item.unit}</Text>
            <Text style={s.cAmt}>{formatAmount(item.amount, cur)}</Text>
          </View>
        ))}

        {/* 合計 */}
        <View style={s.totals}>
          {quote.taxMode !== 'none' && (
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>稅率</Text>
              <Text style={s.totalValue}>{taxPercent}%</Text>
            </View>
          )}
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>小計</Text>
            <Text style={s.totalValue}>{formatAmount(quote.subtotal, cur)}</Text>
          </View>
          {quote.taxMode !== 'none' && (
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>稅額</Text>
              <Text style={s.totalValue}>
                {formatAmount(quote.taxAmount, cur)}
              </Text>
            </View>
          )}
          <View style={s.totalRow}>
            <Text style={[s.totalLabel, s.grandLabel]}>
              {quote.taxMode === 'none' ? '總額' : '總額(含稅)'}
            </Text>
            <Text style={[s.totalValue, s.grandValue]}>
              {formatAmount(quote.total, cur)}
            </Text>
          </View>
        </View>

        {/* 付款方式 / 交付方式 */}
        <View style={s.sectionWrap}>
          <View style={s.sectionCol}>
            <Text style={s.sectionHead}>付款方式</Text>
            <KV label="付款" value={`一次付清　${formatAmount(quote.total, cur)}`} />
            <KV label="付款帳號" value={bank} />
          </View>
          <View style={s.sectionCol}>
            <Text style={s.sectionHead}>交付方式</Text>
            <KV label="交付方式" value={quote.deliveryMethod} />
            <KV label="匯款期限" value={quote.paymentNote} />
          </View>
        </View>

        {/* 甲方 / 乙方 */}
        <View style={s.sectionWrap} wrap={false}>
          <View style={s.sectionCol}>
            <Text style={s.sectionHead}>甲方</Text>
            <KV label="公司名稱" value={quote.client.name} />
            <KV label="統一編號" value={quote.client.taxId} />
            <KV label="負責人" value={quote.client.representative} />
            <KV label="地址" value={quote.client.address} />
            <KV label="電話" value={quote.client.phone} />
            <View style={s.kvRow}>
              <Text style={s.kvLabel}>用印</Text>
              <View style={[s.kvValue, s.stampBox]} />
            </View>
          </View>
          <View style={s.sectionCol}>
            <Text style={s.sectionHead}>乙方</Text>
            <KV label="公司名稱" value={settings.companyName} />
            <KV label="統一編號" value={settings.companyTaxId} />
            <KV label="負責人" value={settings.companyRepresentative} />
            <KV label="地址" value={settings.companyAddress} />
            <KV label="電話" value={settings.companyPhone} />
            <View style={s.kvRow}>
              <Text style={s.kvLabel}>用印</Text>
              {stamps?.company || stamps?.person ? (
                <View style={[s.kvValue, s.stampBox, s.stampFilled]}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf 的 Image 沒有 alt */}
                  {stamps.company && <Image src={stamps.company} style={s.stampCompany} />}
                  {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf 的 Image 沒有 alt */}
                  {stamps.person && <Image src={stamps.person} style={s.stampPerson} />}
                </View>
              ) : (
                <View style={[s.kvValue, s.stampBox]} />
              )}
            </View>
          </View>
        </View>

        {(quote.terms ?? settings.quoteTerms) && (
          <View wrap={false}>
            <Text style={s.termsHead}>備註</Text>
            <Text style={s.termsBody}>
              {wrapText(quote.terms ?? settings.quoteTerms, TERMS_W, 6.8)}
            </Text>
          </View>
        )}

        <Text
          style={s.footer}
          render={({ pageNumber, totalPages }) =>
            `${quote.quoteNo}　·　第 ${pageNumber} / ${totalPages} 頁　·　本報價單有效期限至 ${formatTw(quote.validUntil)}`
          }
          fixed
        />
      </Page>
    </Document>
  )
}
