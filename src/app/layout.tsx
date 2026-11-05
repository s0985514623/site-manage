import type { Metadata } from 'next'
import { Noto_Sans_TC } from 'next/font/google'

import './globals.css'

const notoSansTC = Noto_Sans_TC({
  variable: '--font-noto-tc',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: '網站續約管理',
    template: '%s · 網站續約管理',
  },
  description: '客戶網站的網域、主機、SSL 與維護合約到期追蹤與續約報價系統',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="zh-Hant-TW"
      className={`${notoSansTC.variable} h-full antialiased`}
    >
      <body className="font-sans min-h-full flex flex-col">{children}</body>
    </html>
  )
}
