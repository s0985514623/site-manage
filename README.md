# 網站續約管理系統

客戶網站的網域、主機、SSL、維護合約到期追蹤，以及合併報價單的半自動寄送。

## 這套系統在解決什麼

接案累積的客戶網站愈多，愈難掌握「誰的什麼東西什麼時候到期」。網域過期被搶註、主機停機是最嚴重的客訴，而每年續約又要重複「查到期日 → 算價格 → 打報價單 → 寄信 → 追回覆」。

系統把每個網站所有會到期的項目集中管理，到期前主動提醒，並把同一網站在相近時間到期的項目**合併成一張報價單**，推到 LINE 給你確認，按下確認後才自動寄給客戶。

---

## 快速開始

```bash
# 1. 啟動本機資料庫
docker compose up -d

# 2. 安裝相依套件
npm install

# 3. 設定環境變數
cp .env.example .env.local
#    產生三把祕密：
#    openssl rand -base64 32   → AUTH_SECRET
#    openssl rand -base64 32   → ENCRYPTION_KEY
#    openssl rand -hex 32      → CRON_SECRET

# 4. 建立資料表
npm run db:push

# 5. （選用）匯入示範資料（資料庫已有客戶時會拒絕執行）
npm run db:seed-company
npm run db:seed

# 6. 啟動
npm run dev
```

開啟 http://localhost:3000

> **Windows 注意**：npm 在 Git Bash 下可能因為缺少 `ComSpec` 環境變數而在 postinstall 階段失敗。請改用 PowerShell 執行 `npm install`。

---

## 外部服務設定

三者都可以之後再接。未設定的功能會優雅停用，不影響系統其他部分運作，設定狀態可在「設定」頁查看。

### 1. Google 登入（必要）

系統會跑在公開網址上，必須有登入。

1. [Google Cloud Console](https://console.cloud.google.com/) → API 與服務 → 憑證
2. 建立 OAuth 用戶端 ID → 應用程式類型選「網頁應用程式」
3. 授權的重新導向 URI 填：
   - 本機：`http://localhost:3000/api/auth/callback/google`
   - 正式：`https://你的網域/api/auth/callback/google`
4. 把用戶端 ID 與密鑰填進 `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`
5. `ALLOWED_EMAILS` 填你自己的 Gmail（白名單之外一律拒絕登入）
6. **OAuth 同意畫面若停留在「測試中」狀態，必須把自己加進「測試人員」**，
   否則登入會被擋下並回報 `403 access_denied`

> **為什麼登入不要求 Google Calendar 權限**
>
> Calendar 屬於 Google 的「敏感範圍」。把它綁進登入流程的話，應用程式
> 必須通過 Google 驗證才能發布到正式狀態（需要隱私權政策與首頁網址並
> 等待審核）；若維持「測試中」狀態規避驗證，refresh token 只有 7 天壽命，
> 行事曆同步每週都會斷掉。
>
> 因此採漸進式授權：登入只要 `openid email profile`（非敏感範圍，可直接
> 發布到正式狀態），行事曆權限等到真的要開啟同步時再單獨要一次。

### 2. Resend 寄信

1. 註冊 [Resend](https://resend.com/)，取得 API Key
2. **在 Resend 加入你自己的網域並完成 SPF / DKIM 設定**
3. `MAIL_FROM` 使用該網域的寄件地址，例如 `報價通知 <notice@yourdomain.com>`

> 未設定 SPF / DKIM 就寄信，報價單極可能進客戶的垃圾桶，而客戶只會跟你說「我沒收到」。

### 3. LINE Messaging API

1. [LINE Developers Console](https://developers.line.biz/) 建立 Provider 與 Messaging API channel
2. 取得 `LINE_CHANNEL_ACCESS_TOKEN` 與 `LINE_CHANNEL_SECRET`
3. Webhook URL 設為 `https://你的網域/api/line/webhook` 並啟用
4. 用自己的 LINE 帳號加官方帳號好友，傳一則訊息，從伺服器記錄取得你的 `userId`，填入 `LINE_ADMIN_USER_ID`

> **`LINE_ADMIN_USER_ID` 是安全關鍵**：沒有它，任何加了你官方帳號好友的人只要猜到 postback 格式，就能讓系統寄報價單給你的客戶。未設定時系統不會自動寄信，只會通知你。

本機開發時 webhook 需要公開 HTTPS，用 `cloudflared tunnel --url http://localhost:3000` 或 ngrok 打通，並把 Console 的 Webhook URL 暫時指向該網址。

---

## 資料結構

```
客戶 (clients)
 ├─ 聯絡人 (contacts)        決策者 / 財務 / 技術窗口各自獨立
 └─ 網站 (sites)             ← 報價合併以此為單位
     └─ 服務項目 (services)   ← 核心表
         └─ 登入憑證 (credentials)  AES-256-GCM 加密
```

**為什麼服務項目要獨立成一張表**：一個網站會到期的東西至少六種（網域、主機、SSL、維護合約、外掛授權、企業信箱），各自有不同供應商、不同到期日、不同價格。把它們塞進網站的欄位裡，第一次遇到「同一客戶兩個網域、主機在別家」就會卡住。

### 幾個刻意的設計決定

| 決定 | 原因 |
|---|---|
| 到期日用 `date` 而非 `timestamp` | 伺服器跑 UTC、你人在台北。timestamp 相減會讓剩餘天數差一天，而差一天足以讓網域過期 |
| 金額用 `numeric(12,2)`，運算轉整數「分」 | `0.1 + 0.2 !== 0.3`。稅額差一塊錢客戶就會來問 |
| `is_ours` 區分代管與客戶自管 | 客戶自己買的網域一樣要提醒（到期會炸在你身上），但絕不能開進報價單，否則重複收費 |
| 偵測到的到期日不直接覆蓋人工值 | WHOIS 解析錯誤會導致報價單在錯的時間、用錯的金額寄出 |
| 刪客戶有報價單時會被擋下 | 報價單是財務紀錄。結束合作請用「停用」保留歷史 |

---

## 合併報價的規則

當某個網站**最早到期**的項目剩下 `quoteTriggerDays`（預設 45）天時，系統把該網站在錨點日往後 `quoteWindowDays`（預設 60）天內到期的項目全部合併成一張報價單。

### 最重要的一條規則

**每個項目的服務期間各自從它自己的到期日起算。**

```
網域 2026/11/08 到期 → 期間 2026/11/08 ~ 2027/11/08
主機 2026/12/08 到期 → 期間 2026/12/08 ~ 2027/12/08   ← 不是從 11/08 起算
```

主機明明 12 月才到期，卻在 10 月跟著網域一起收錢。若把主機的新期間也從錨點日起算，客戶等於白白少了一個月的主機服務。報價單上逐項標明期間，客戶對帳時一看就清楚沒被多收。

這條規則有專門的測試守著（`npm run verify:quotes`）。

### 會被排除的情況

- `is_ours = false`（客戶自管）：照常提醒，不計費
- 沒設售價的代管項目：不開進報價單，避免寄出零元報價
- 同一網站混用不同幣別：整組略過並提示，不會把 TWD 與 USD 相加

---

## 到期提醒

每日掃描，在剩餘 **90 / 60 / 30 / 14 / 7 / 1 / 0** 天時各提醒一次，逾期後**每天**提醒。

- 彙總成「一封 Email + 一則 LINE」，不是每筆一則——十個項目同時到期時，十則通知只會讓人直接忽略
- 沒有任何異動時完全不通知，避免把人訓練成忽略通知
- 以 `(項目, 門檻, 管道, 日期)` 去重，同一天不會重複寄
- LINE 免費額度快用完時自動降級成只寄 Email，把剩餘額度留給報價確認訊息

`0`（今天到期）刻意納入門檻：只設到 1 天前的話，到期當天不會有任何通知，而網域當天就會停止解析。

---

## 指令

| 指令 | 說明 |
|---|---|
| `npm run dev` | 開發伺服器 |
| `npm run build` | 正式建置 |
| `npm run typecheck` | 型別檢查 |
| `npm run db:push` | 把 schema 套用到資料庫（僅限本機資料庫） |
| `npm run db:studio` | 開啟 Drizzle Studio 瀏覽資料 |
| `npm run db:seed` | 匯入示範資料（僅限本機的空資料庫） |
| `npm run db:reset` | 清空所有業務資料（僅限開發） |
| `npm run verify` | 執行全部驗證 |

### 驗證腳本

型別檢查抓不到執行期的邏輯錯誤，所以關鍵邏輯各有專門的驗證：

| 指令 | 驗證內容 |
|---|---|
| `verify:logic` | 稅額計算、浮點誤差、計費週期推進、跨時區天數、加密與竄改偵測 |
| `verify:queries` | 各頁面實際使用的資料庫查詢 |
| `verify:scan` | 提醒門檻觸發、同日去重、跨日重新提醒 |
| `verify:quotes` | 合併分組、**各項期間各自起算**、同月連號、防重複開單、混幣別與未定價的排除 |
| `verify:font` | PDF 中文字型內嵌與罕用字涵蓋 |

`verify:font` 是獨立的 `.mjs`：`@react-pdf/renderer` 依賴的套件是純 ESM
且 exports map 沒有 `require` 條件，用 tsx 執行會在解析階段失敗。
其餘腳本則加上 `--conditions=react-server`，讓 `server-only` 解析到空模組
（它在純 Node 下預設會拋錯）。

### 字型

報價單 PDF 的中文字型由 `npm run build:fonts` 產生（需要 `pip install fonttools brotli`）。
子集刻意保留完整的 CJK 基本區：客戶名稱是自由輸入的文字，切太小會讓罕用字
在寄出去的 PDF 上變成空白方框。產物約 5.4 MB × 2，已納入版控以簡化部署。

---

## 排程設定

所有 `/api/cron/*` 端點以 `CRON_SECRET` 保護：

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
     "$APP_URL/api/cron/expiry-scan"
```

加上 `?dryRun=1` 只計算不寄送，調整過觸發天數後用來確認名單：

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
     "$APP_URL/api/cron/expiry-scan?dryRun=1"
```

建議排程（台北時間）：

| 端點 | 頻率 | 說明 |
|---|---|---|
| `/api/cron/expiry-scan` | 每日 09:00 | 到期彙總通知 |
| `/api/cron/quote-draft` | 每日 09:30 | 擬合併報價草稿並推 LINE 確認 |

## LINE 審核流程

`quote-draft` 產生草稿後推一則 Flex Message 給你，訊息上**按鈕正上方會列出
收件人 Email** 供核對，下方三顆按鈕：確認寄出 / 我要修改 / 取消。

按下「確認寄出」後，webhook 依序過四道關卡，任一不過就絕不寄信：

1. `X-Line-Signature` HMAC-SHA256 驗證（擋偽造請求）
2. `userId` 必須等於 `LINE_ADMIN_USER_ID`
3. 一次性 token 的**原子消耗**（`UPDATE ... WHERE used_at IS NULL`，
   由資料庫保證；不是先查再改，所以連點兩下不會寄出兩封）
4. 報價單狀態仍須為 `pending_approval`

寄信失敗時報價單會退回草稿並在 LINE 回報原因，不會卡在無法處理的狀態。

---

## ⚠️ 關於 `ENCRYPTION_KEY`

主機帳密、網域 EPP Auth Code 都用這把金鑰加密。

**金鑰遺失 = 所有密文永久無法還原。**

請務必在密碼管理器或紙本另存一份，且絕不可提交進 git。更換金鑰前必須先用舊金鑰解密全部資料再重新加密，否則等同銷毀。
