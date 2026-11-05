import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * 產出 .next/standalone —— 一包不含 node_modules 的最小部署產物，
   * 附一支 server.js 可直接 `node server.js` 啟動。正式映像因此不必
   * 裝 1 GB 的相依套件。
   *
   * 注意：standalone 不會自動帶上 public/ 與 .next/static，要手動複製
   * （Dockerfile 的 builder 階段已處理）。這一步漏掉的話中文字型會跟著
   * 消失，產出的 PDF 會變成一整片空白方框卻不報錯。
   */
  output: 'standalone',

  experimental: {
    serverActions: {
      /**
       * 回簽報價單的上傳走 Server Action，預設上限只有 1MB。
       *
       * 實際檔案上限是 10MB（在 src/server/actions/attachments.ts 驗證），
       * 這裡多留 2MB 給 multipart 的邊界與欄位中繼資料 —— 逼近上限時
       * 那些額外位元組會讓請求被擋下，錯誤訊息卻只說「Body exceeded」。
       */
      bodySizeLimit: '12mb',
    },
  },
}

export default nextConfig
