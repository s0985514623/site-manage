# 決策紀錄（Decision Log）

> 給下一次對話（人或 AI）快速接手用。每條決策都寫「決定了什麼」＋「為什麼／怎麼套用」。
> 細節規格看 `specs/`，實作計畫看 `plans/site-ops-expansion/`，澄清問答原文看 `specs/clarify/2026-11-16-1046.md`。
> 最後更新：2026-11-19

---

## 0. 目前狀態（先看這裡）

- 分支：`main`（2026-11-18 已上線；GitHub `s0985514623/site-manage`，push main 自動部署）
- 第 0～6 階段＋兩個追加功能已完成並 commit：
  | Commit | 內容 |
  |---|---|
  | `bee34b4` | 第 0 階段：Vitest 測試基礎 |
  | `9bcec8c` | 第 1 階段：migration 0001、報價單可不綁網站 |
  | `757e014` | 第 2 階段：專案、里程碑、專案管理日曆、轉維運、專案報價 |
  | `49d8218` | 第 3 階段：寄送模式、手動寄出、報價與收款追蹤 |
  | `ec6eade` | 第 4 階段：LINE 查詢與快速新增專案 |
  | `1006e28` | 第 5 階段：週報、8 支排程心跳、systemd timer |
  | `cd749bc` | 第 6 階段：PHP 外部監控腳本 |
  | `ff36bdd` | 追加：專案多段自訂時程（跨日事件同步日曆） |
  | `d7ae681` | 追加：報價單自動用印（乙方大小章） |
- 驗證狀態：219 個測試通過、規格範例覆蓋 139/139、`npm run verify`、build、lint 皆通過。
- **已上線（2026-11-18）**：https://site-manager.ren-codes.com ，版本 `0cbe4d4`。
  - 本機資料（20 客戶、23 網站、31 服務、22 聯絡人、19 帳密、大小章、設定、報價單 261118）已用 data-only pg_restore 匯入正式庫。
  - 正式環境的 `ENCRYPTION_KEY` 沿用本機的（才能解開匯入的帳密）；`AUTH_SECRET`、`CRON_SECRET` 為 VPS 新產生。
  - LINE 改用**新的官方帳號**（webhook 指向正式站，rich menu 已建立）。
  - 9 支 systemd timer 已啟用；`/api/cron/*` 由 Caddy 對外回 404。
  - **之後資料以正式環境為準**，本機只做開發測試，不會同步上去。

---

## 1. 產品方向（使用者原始目標）

1. 管理既有網站客戶，到期前自動建立報價單，由使用者手動寄出（未來可改為 LINE 確認後自動寄）。
2. 建立新專案並連結 Google Calendar 做專案管理。
3. 除網頁後台外，也能透過 LINE 查詢／新增／管理。
4. 盡可能自動化、減少人工遺漏。

**使用者只有一人**（單一使用者，不做多帳號權限）。

---

## 2. 功能決策

### 報價與寄送
- **寄送模式開關**：手動寄出 ↔ LINE 確認後自動寄。設定欄位 `settings.auto_send_enabled`。
  - D1：既有安裝升級後**維持自動寄**（migration 0001 末尾 `UPDATE settings SET auto_send_enabled = true`）。
- 手動模式下由後台按「寄出」，系統經 Resend 寄出（不是使用者自己用 Gmail 寄附件）。
- 寄送採「先搶佔（conditional UPDATE）再寄，失敗釋放」，防止重複寄送／重複收款。
- 專案也可以產生報價單 → `quotes.site_id`、`anchor_date` 改為 nullable，新增 `project_id`；CHECK 至少有網站或專案其一。
- **手動開立續約報價單**（2026-11-18 追加）：網站頁「服務項目」卡片右上、到期總表每個網站最早可報價那列有按鈕。
  - 與排程共用 `groupForSite`（視窗合併、售價、幣別檢查），但**不檢查觸發天數**；產生後停在 `draft`、**不推 LINE**，直接跳到報價單頁由管理者寄出。
  - 失敗：`NOT_FOUND`、`NO_RENEWABLE_SERVICE`（沒項目／沒售價／合計 0／已被涵蓋）、`MIXED_CURRENCY`。
  - `createQuoteForGroup` 認領服務改為條件式（`current_quote_id IS NULL`），連點或與排程同時跑不會開出重複報價單。
- 防漏四件套全做：報價追蹤（`quote_followup_days`）、收款追蹤（`paid_on`/`paid_amount`）、排程掛掉告警、每週週報。

### 專案
- 類別固定四種：`new_site`（新網站製作）、`custom_plugin`（客製外掛）、`bug_fix`（BUG 排除）、`other`。
- 所有類別共用狀態：待開始 → 進行中 → 待驗收 → 已完成（共用流程＋類別標籤，不做各類別不同流程）。
- 專案**可以不綁網站**。
- 里程碑：多個自訂里程碑。
- 時程：可自由新增多段（例如「前端開發」「後端開發」），各自有開始日（選填）與結束日，開始 > 結束時回 `INVALID_DATE_RANGE`；開始日＝結束日或沒填開始日時視為單日里程碑。
- 只有 `new_site` 完成時跳出「轉維運」表單：勾選服務、填到期日與價格 → 建立 services（`source_project_id` 記來源）。

### Google Calendar
- 另開一個「專案管理」日曆（`settings.gcal_project_calendar_id`），**單向寫入**（系統 → 日曆，不讀回）。
- 事件標題前綴：【專案截止】、【時程】（跨日事件）、【里程碑】。

### LINE
- 支援查詢＋快速新增（**只做新增專案**），用按鈕一步一步選（quick reply）。
- Quick reply 上限 13 顆：12 個客戶＋搜尋＋取消會超過，所以 12 個客戶時省略取消鈕；任何步驟輸入「取消」都能取消。
- Rich Menu 用一次性腳本建立：`npm run line:richmenu`（圖檔 `scripts/assets/richmenu.png`）。

### 監控
- 排程（cron）成功時 ping 心跳（`runCronJob` 包裝，`HEARTBEAT_URL` / `HEARTBEAT_TOKEN`）。
- 外部監控放在使用者**另一台 PHP 主機**：`tools/php-monitor/`，心跳逾時就用 LINE＋email 告警；兩者都失敗時取消已告警標記，下次重試。
- **排程任務改由資料庫管理**（2026-11-19）：設定頁「排程任務」可調整 8 支內建任務的時間／停用，並可新增三種任務：LINE 提醒（額度不足改寄 Email）、呼叫網址（GET/POST，30 秒逾時）、替內建任務多加時段。
  - 時間用選單式（每 N 分鐘／每天／每週幾／每月幾號 + HH:MM，台北時間），不開放 cron 表達式。每月 29–31 號遇小月改在月底。
  - VPS 只剩一支每分鐘的 `site-manager-cron-tick.timer` → `/api/cron/tick` → `runDueTasks()`（`src/server/ops/scheduled-tasks.ts`）。
  - 執行前先條件式更新 `next_run_at`（搶佔），重疊的 tick 不會重複執行；停機錯過多次只補跑一次；`next_run_at` 為 NULL 的任務第一次 tick 只排定不執行（migration 種下的任務上線時不會補跑）。
  - 內建任務（`system = true`）不可刪除（`SYSTEM_TASK_NOT_DELETABLE`），只能改名稱、時間、啟用；執行時直接呼叫原本的 route handler，心跳行為不變。
  - 停用或拉長內建任務間隔時，PHP 監控的 `jobs` 門檻要手動同步調整。
- 網站存活監控（uptime）每 15 分鐘一次（2026-11-19 從每小時改）：連續 2 次失敗才告警，約 30 分鐘內通知；負擔可忽略。PHP 心跳門檻同步改 1 小時。

### 報價單用印（大小章）
- 使用者在後台「設定 → 報價單用印」自行上傳大章（公司章）與小章（負責人章），PNG/JPEG、2MB 以內。
- 圖檔存資料庫（`stamps` 表，bytea），**不進 git、不交給 AI**；預覽 API 需登入。
- 有「自動用印」開關（`settings.stamp_enabled`）；甲方用印欄永遠留白給客戶蓋。
- PDF：大章 66pt、小章 34pt，甲乙方用印欄高度都是 72pt。

---

## 3. 技術與流程決策

- **規格驅動（AIBDD）**：`specs/` 裡有 activities、19 個 `.feature`（130 個 Examples）、`entity/erm.dbml`、`api/api.yml`。新功能先寫 `.feature` 再實作。
- **測試**：手寫 Vitest（D2），獨立測試資料庫 `TEST_DATABASE_URL`（必須是本機、DB 名稱以 `_test` 結尾）；外部 API（LINE / Resend / Google / 心跳）以 fake fetch 攔截；`今天是()` 固定時間。
  - `npm run test:coverage-map`（`scripts/check-feature-coverage.ts --all`）比對 Example 名稱與測試名稱，必須 100%。
- **CI 失敗擋住部署**（D3）。
- 服務層：`src/server/<domain>` 回傳 `ActionState { ok?, error?, violationType? }`；server action 只是薄包裝。
- 通知去重靠 partial unique index。
- Next.js 16：middleware 改名為 proxy（`src/proxy.ts`）；新增路由後要跑 `npx next typegen` 才有 `PageProps<'/route'>` 型別。
- 原生 SQL 模板內不要直接放 `Date` 物件，要用 `.toISOString()`（postgres.js 會炸）。

---

## 4. 部署決策（已上線）

- 依 `D:\Dev\line-accounting\deploy\SHARED-VPS-SPEC.md` 共用 VPS 規格：VPS 已有 Docker＋Caddy＋共用 Postgres。
- App 代號 `site-manager`，image `ghcr.io/s0985514623/site-manage`。
- 排程用 **systemd timer**：每分鐘一支 tick＋每日備份（2026-11-19 前是 8 支寫死時間的 timer），在容器內執行 `scripts/run-cron.mjs`。換 timer 的步驟見 `deploy/README.md`「從 8 支 timer 換成 tick」。
- Caddy 擋掉外部存取 `/api/cron/*`；健康檢查 `/healthz`。
- 部署步驟見 `deploy/README.md`（A～I）。
- VPS 管理用 `root@139.162.95.207`（金鑰 `~/.ssh/id_ed25519` 有 passphrase；Windows ssh-agent 被停用，改用 Git Bash 的 ssh-agent + 彈窗輸入）。
- VPS 上的網路名稱是底線：`proxy_site_manager`、`db_site_manager`。
- **手動重啟容器必須帶 `APP_IMAGE`**（`.env` 沒有存映像版本，直接 `docker compose up` 會退回 whoami 佔位映像）：
  `sudo -u deploy env APP_IMAGE="ghcr.io/s0985514623/site-manage:$(cat .last_good_tag)" docker compose -p site-manager -f docker-compose.yml up -d --no-deps app`
- 正式 `.env` 必須有 `AUTH_URL=https://site-manager.ren-codes.com`：沒有的話 Auth.js 把回呼網址算成 `https://0.0.0.0:3000`，Google 登入失敗（error=Configuration）。
- CI 的 `typecheck` 會先跑 `next typegen`（乾淨環境沒有 `.next/types`）。

---

## 5. Email 架構（已設定完成，使用者確認可用）

- 寄信：Resend（`MAIL_FROM` = 冠澄數位行銷 <service@ren-codes.com>），VPS **不需要 mail server**。
- 收信：Cloudflare Email Routing 把 service@ren-codes.com 轉到使用者的 Gmail。
- 回信：Gmail「以這個地址寄信」走 smtp.resend.com:465。
- 報價信的 Reply-To ＝ 設定頁「公司 Email」（service@ren-codes.com）。
- 不要建議架 mail server 或改根網域 MX。

---

## 6. 資料與安全約定

- 使用者的 Google Sheet 網站資料已匯入**本機開發資料庫**（19 客戶、23 網站、31 服務、19 聯絡人；之後使用者自行加到 21 客戶）。
  - 網域到期日是推算的，備註「待 WHOIS 確認」；網域價格空白。
  - 帳密 19 筆以 AES-256-GCM 加密存入（同 `src/lib/crypto.ts` 格式），明文檔已刪除。
- 帳密只能加密儲存；章的圖檔只由使用者自己上傳。
- 使用者 email 等個資不可送到外部服務。
- 開發 DB 沒有 migrations 表，schema 變更用 `drizzle-kit push --force`；`npm run verify` 用獨立 DB `site_support_verify`。
- 不要在使用者的 Chrome 寫入測試 session cookie（曾覆蓋掉使用者登入）。

---

## 7. 已知非問題

- 刪除時 console 出現 `e?.startsWith is not a function`：來自 Chrome 擴充功能，不影響操作，不用修。
- 新增客戶一直轉圈：dev 重新編譯後舊分頁失效造成，重整即可（已確認）。

---

## 8. 協作偏好

- 需要使用者做決定時，用**互動式選單**（AskUserQuestion）給選項。
- 回覆用繁體中文、ADHD 友善格式（第一行就是行動、步驟編號、具體時間估計）。

---

## 9. 待辦（使用者端）

1. Google Cloud Console 的 OAuth 用戶端加兩個重新導向 URI（正式站登入、Google Calendar）。
2. 正式站登入後台 → 設定 → 重新連結 Google Calendar。
3. LINE 新帳號 Console 按 Webhook「Verify」；後台「設定」視需要改報價單上印的公司 LINE ID。
4. 需要監控的網站在網站頁打開「監控」開關（預設關閉）。
5. 異地備份：VPS 的 `backups/` 只存在同一台機器上。
