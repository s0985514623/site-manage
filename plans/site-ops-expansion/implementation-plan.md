# 實作計劃：專案管理 / LINE 操作 / 防遺漏自動化

> 範圍模式：**HOLD SCOPE**（規格已由 Phase 01–04 定案，120 個 Examples；本計劃只排實作順序，不增減需求）
> 預估影響：約 45–55 個檔案（含測試）。已依階段切開，每階段可獨立合併、獨立部署。
> 規格來源：`specs/`（features、activities、entity/erm.dbml、api/api.yml）、`plans/site-ops-expansion/execution-plan.md`

## 概述

在既有「網站到期 → 續約報價 → LINE 確認寄信」系統上，新增專案管理（含 Google 日曆）、寄送模式切換、報價追蹤與收款、LINE 查詢與逐步新增、週報、健康檢查與排程心跳。同時導入 Vitest + 獨立測試資料庫，把 `.feature` 的 Examples 轉成自動化測試。PHP 外部監控腳本為獨立交付物，放在最後。

## 需求重述

- 使用者：系統唯一管理者（網頁後台 + LINE）、排程器（VPS cron）、外部監控主機（PHP）。
- 成功的樣子：120 個 Examples 皆有對應通過的測試；既有 `npm run verify` 全綠；部署後既有續約流程行為不變（除了用戶決定的寄送模式）；8 支排程都會送心跳。

## 已知風險（來自研究）

| # | 風險 | 來源 | 緩解 |
|---|------|------|------|
| R1 | `quotes.site_id` 與 `anchor_date` 改可空，舊程式假設非空 → 無網站報價在列表消失、PDF / 信件 / LINE 文字出現 `undefined` | clarifier 影響清單 + 本次掃描補上 anchor_date（`queries.ts:109`、`quotes/[id]/page.tsx:179`） | 第 1 階段集中處理，加 `報價顯示名稱()` 單一函式；TypeScript 會在 `.notNull()` 拿掉後把所有用到的地方標紅，逐一修到 `npm run typecheck` 通過 |
| R2 | 部署當下寄送模式改變：`auto_send_enabled` 預設 false，但目前正式環境實際行為是「LINE 確認後自動寄」 → 已推出去、尚未按的 LINE 確認按鈕會被拒 | 規格 `切換報價寄送模式.feature` × 現況 | 已決定（D1）：migration 對既有設定列寫入 `auto_send_enabled = true`；欄位預設仍為 false（新安裝依規格手動寄） |
| R3 | 測試誤連正式資料庫 | 既有 `scripts/local-db-guard.ts` | 測試沿用 `assertLocalDatabase()`，再加一道「資料庫名稱必須以 `_test` 結尾」；測試只讀 `TEST_DATABASE_URL`，不讀 `.env.local` 的 `DATABASE_URL` |
| R4 | 模組在 import 時就讀環境變數（`src/lib/env.ts` 頂層 `load()`、`import 'server-only'`） | 讀碼 | Vitest `setupFiles` 先設好 `process.env` 再載入；`server-only` 以 alias 指到空模組 |
| R5 | 固定時鐘只能假 JS `Date`；Postgres `now()` / `defaultNow()` 不受控 | 讀碼（目前只有 `defaultNow()`，無查詢用 `now()`） | 規則：所有業務判斷用 `today()` / JS `Date` 算好再傳進 SQL；不在查詢條件寫 `now()` / `current_date`；`vi.useFakeTimers({ toFake: ['Date'] })` 只假 Date，避免卡住 postgres 連線計時器 |
| R6 | 重複點擊「寄出」/「登記收款」造成重複寄信 / 重複入帳；現有 `send-quote.ts` 先寄信才更新狀態，沒有搶佔 | 讀碼 | 先以條件式 UPDATE 搶佔（`WHERE sent_at IS NULL` / `paid_on IS NULL` RETURNING），寄信失敗再還原 |
| R7 | `notifications` 唯一索引 `notifications_dedupe_key(service_id, level, channel, sent_on)` 在 service_id 可空後對報價追蹤 / 週報無效 | 讀碼 | 改為三個部分唯一索引（見架構變更）；`expiry-scan.ts:118` 的 `onConflictDoNothing()` 不指定 target，仍可用 |
| R8 | Next.js 16 有 breaking changes | AGENTS.md | 每階段動到 route handler / server action 前先讀 `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` 與 `testing/vitest.md`；Vitest 官方指引：async Server Component 不做單元測試 |
| R9 | `deploy.yml` 目前有未提交修改 | git status | 第 0 階段改 CI 前先確認該修改已提交或合併，避免覆蓋 |

## 架構變更

### 測試基礎（第 0 階段）
- `vitest.config.mts`：node 環境、`vite-tsconfig-paths`、alias `server-only` → 空模組、`fileParallelism: false`（共用一個測試 DB）、`globalSetup` + `setupFiles`
- `tests/setup/global-setup.ts`：讀 `TEST_DATABASE_URL` → `assertLocalDatabase('vitest')` + 名稱 `_test` 檢查 → 重建 schema → 跑 `src/db/migrations`（用 drizzle migrator，順便驗證 migration 本身）
- `tests/setup/per-test.ts`：設 `process.env`（含假 LINE secret）、mock `next/cache`、`@/auth`（`requireUser` 回固定 email）、每個測試前 TRUNCATE 所有表 + 固定時鐘
- `tests/fakes/`：`line.ts`（記錄 push / reply，可設額度不足）、`mailer.ts`（記錄信件，可設失敗）、`gcal.ts`（記錄事件、可設失敗）、`heartbeat.ts`（記錄 ping）、`env-features.ts`（切換 `line_admin_configured` / `mail_configured`）
- `tests/support/`：`clock.ts`（`今天是(date)` → 台北 10:00）、`given.ts`（C1–C8 共用 Given 建資料）、`then.ts`（`操作成功` / `操作失敗(violation)`）、`line-sign.ts`（webhook 簽章）
- `scripts/check-feature-coverage.ts`：掃 `.feature` 的 Example / Scenario Outline 名稱，比對 `tests/**/*.test.ts` 的 `it()` 名稱，缺漏就失敗（`npm run test:coverage-map`）
- `package.json`：`test`、`test:watch`、`test:coverage-map`；devDeps：`vitest`、`vite-tsconfig-paths`
- `.env.example`：新增 `TEST_DATABASE_URL=postgresql://...@localhost:5432/site_support_test`
- `.github/workflows/deploy.yml` verify job：建立 `site_support_test` → `npm test` → `npm run test:coverage-map`

### 服務層慣例（所有階段沿用）
- 業務邏輯放 `src/server/<domain>/*.ts`（純函式 + DB），回傳 `ActionResult`；`src/server/actions/*.ts` 只做 `requireUser()` + FormData 解析 + `revalidatePath()`。測試直接呼叫服務函式與 route handler 的 `GET/POST(Request)`。
- `src/server/actions/helpers.ts`：`ActionState` 加 `violationType?: ViolationType`（14 種，來自 api.yml）；新增 `fail(violation, message)`。

### 資料庫（第 1 階段，一支 migration）
- `src/db/schema.ts` + `src/db/migrations/0001_*.sql`
  - 新 enum：`project_category`、`project_status`、`notify_kind`、`line_flow_step`
  - 新表：`projects`、`project_milestones`、`line_conversations`
  - `quotes`：`site_id`、`anchor_date` 拿掉 notNull；加 `project_id`、`accepted_at`、`paid_on`、`paid_amount`；CHECK `site_id IS NOT NULL OR project_id IS NOT NULL`；索引 `quotes_project_idx`
  - `settings`：`auto_send_enabled`、`quote_followup_days`、`gcal_project_calendar_id`
  - `notifications`：加 `kind`（預設 expiry）、`quote_id`；`service_id` 可空；刪 `notifications_dedupe_key`，改三個部分唯一索引：服務類 `(kind, service_id, level, channel, sent_on) WHERE service_id IS NOT NULL`、報價類 `(kind, quote_id, channel, sent_on) WHERE quote_id IS NOT NULL`、全域類 `(kind, channel, sent_on) WHERE service_id IS NULL AND quote_id IS NULL`
  - `services`：加 `source_project_id`
  - D1：欄位 `DEFAULT false`，migration 末段 `UPDATE settings SET auto_send_enabled = true`（只影響既有列；新安裝無列，`getSettings()` 建立時用預設 false）

### 新模組
- `src/lib/quote-display.ts`：`quoteSubjectName(quote)` → 網站名稱 ?? 專案名稱；`isRenewalQuote(quote)`
- `src/lib/heartbeat.ts`：`pingHeartbeat(job)`；未設 `HEARTBEAT_URL` 時略過並記 log；失敗不拋錯、逾時 5 秒
- `src/lib/cron.ts`：加 `runCronJob(name, request, handler)` 包裝（驗證 → 執行 → 成功才 ping）
- `src/lib/gcal.ts`：`ensureCalendar(kind: 'expiry' | 'project')`、`upsertEvent` / `deleteEvent` 帶 calendar 參數
- `src/server/projects/*`、`src/server/quotes/{send,followup,payment}.ts`、`src/server/line/{query,quick-add}.ts`、`src/server/ops/weekly-report.ts`
- 新路由：`src/app/api/cron/{quote-followup,payment-followup,weekly-report}/route.ts`（健康檢查 `src/app/healthz/route.ts` 已於部署設定時完成）
- 新頁面：`src/app/(dashboard)/projects/`（列表、新增、詳情含里程碑 / 狀態 / 轉維運表單 / 產生報價）

## 資料流分析

### A. 手動寄出報價單（含重複點擊）
```
按「寄出」──▶ 驗證 ──────────▶ 搶佔 ─────────────────▶ 寄信 ──────────▶ 完成
  │            │                 │                        │                │
  ▼            ▼                 ▼                        ▼                ▼
[quote 不存在] [status≠draft]   [UPDATE sent_at=now       [Resend 失敗]    [更新 renewal_state]
 NOT_FOUND     INVALID_QUOTE_    WHERE sent_at IS NULL    還原 sent_at     [revalidate]
              STATUS            RETURNING 0 列]          MAIL_SEND_FAILED
              [無收件人]          QUOTE_ALREADY_SENT
               NO_RECIPIENT
              [寄信未設定]
               MAIL_NOT_CONFIGURED
```

### B. LINE 確認報價單（依寄送模式分流）
```
postback ──▶ 驗簽 ──▶ 管理者? ──▶ 消耗 token ──▶ 讀 auto_send_enabled ──▶ true: 走 A 的寄信 ──▶ 回覆結果
               │         │            │                 │
               ▼         ▼            ▼                 ▼
            [401]    [非管理者:     [過期/已用:       false: 拒絕寄信，回覆「目前為手動寄送模式，請至後台寄出」
                      記錄+拒絕]     回覆對應訊息]     （token 不消耗；正式環境依 D1 維持 true，部署後不會走到此分支，除非手動切換）
```

### C. 排程追蹤（未回覆 / 未收款，兩支同構）
```
cron ──▶ 驗證 ──▶ 撈候選(JS 算好日期) ──▶ 去重(notifications) ──▶ 彙總成一則 LINE ──▶ 寫通知紀錄 ──▶ ping 心跳
          │          │                       │                       │                   │              │
          ▼          ▼                       ▼                       ▼                   ▼              ▼
        [401]    [0 筆: 不推，             [今天已推: 略過]          [額度不足: 改 Email]  [unique 衝突:    [失敗: 只記 log
                  仍 ping]                                         [Email 也失敗: 記     視為已推]       不影響回應]
                                                                    ok=false]
          dryRun=1：只回傳名單，不推、不寫、不 ping
```

### D. 專案日期寫入 → 專案管理日曆
```
建立/編輯專案或里程碑 ──▶ 驗證 ──▶ 寫 DB(交易) ──▶ upsert 日曆事件 ──▶ 回存 gcal_event_id
                           │          │                 │
                           ▼          ▼                 ▼
                    [名稱空白/日期反轉/  [失敗: 整筆回滾]   [Google 失敗/未授權:
                     金額<0/網站不屬     操作失敗          操作仍成功，event_id 留空
                     該客戶/客戶停用]                      → 每日 gcal-sync 對帳補上]
```

### E. LINE 快速新增專案（逐步對話）
```
Rich Menu「新增專案」──▶ 建 line_conversations(step=choose_client, expires=+30m)
  ──▶ 選客戶(Quick Reply, 12 位 + 關鍵字) ──▶ 選類別 ──▶ 輸入名稱 ──▶ 選日期(可略過) ──▶ 呼叫 建立專案 服務 ──▶ 刪對話
         │                                     │            │              │                  │
         ▼                                     ▼            ▼              ▼                  ▼
   [過期: 刪對話，提示重來]               [非預期輸入:   [空白名稱:      [略過: due=null]   [建立失敗: 回覆原因，
   [「取消」: 刪對話]                      重問本步]     重問]                               保留對話可重試]
   [非管理者: 拒絕]
```

### F. 健康檢查
```
GET /healthz ──▶ SELECT 1(逾時 3 秒) ──▶ 200 {status:ok}
                          │
                          ▼
                  [失敗/逾時] ──▶ 503 {status:error}（不帶任何細節）
```

## 錯誤處理登記表

| 方法/路徑 | 可能失敗原因 | 錯誤類型 | 處理方式 | 使用者可見? |
|-----------|--------------|----------|----------|-------------|
| `sendQuoteManually` | 已寄出 / 重複點擊 | QUOTE_ALREADY_SENT | 條件式 UPDATE 搶佔 | 是，表單錯誤 |
| `sendQuoteManually` | Resend 失敗 | MAIL_SEND_FAILED | 還原 sent_at，記 activity | 是 |
| `sendQuoteManually` | 無收件人 / 未設定寄信 | NO_RECIPIENT / MAIL_NOT_CONFIGURED | 寄信前檢查 | 是 |
| `setQuoteSendingMode` | 切 LINE 模式但未設管理者 | LINE_ADMIN_NOT_CONFIGURED | 拒絕，設定不變 | 是 |
| `registerPayment` | 已登記 / 重複點擊 | ALREADY_PAID | `WHERE paid_on IS NULL` | 是 |
| `registerPayment` | 金額 ≤ 0、日期晚於今天、狀態不對 | INVALID_ARGUMENT / INVALID_QUOTE_STATUS | Zod + 狀態檢查 | 是 |
| `createProject` / `updateProject` | 客戶停用、網站不屬客戶、日期反轉 | CLIENT_INACTIVE / SITE_CLIENT_MISMATCH / INVALID_DATE_RANGE | 驗證 | 是 |
| `deleteProject` | 有報價單 | PROJECT_HAS_QUOTES | 檢查 + FK restrict 雙保險 | 是 |
| `submitHandover` | 非新網站 / 未完成 / 已轉維運 | HANDOVER_NOT_ALLOWED | 交易內鎖專案列再檢查 | 是 |
| 日曆同步（專案 / 里程碑） | Google API 失敗、未授權 | 外部錯誤 | 不擋存檔；記 activity；每日對帳補 | 否（頁面顯示「日曆未同步」標記） |
| LINE webhook | 簽章錯 | 401 | 既有 | 否（LINE 平台） |
| LINE 回覆 / 推播 | API 失敗 | 外部錯誤 | 記 log；排程類改 Email | 是（收到 Email） |
| 排程 Email 備援也失敗 | Resend 失敗 | 外部錯誤 | notifications `ok=false` + error；cron 回應列出 errors；心跳照送（排程本身有跑） | 否 → 由 PHP 監控之外無告警：**接受**，回應 JSON 可查 |
| `pingHeartbeat` | 心跳端點不通 | 外部錯誤 | 記 log，不影響排程 | 否 → PHP 端會因收不到心跳而告警（設計即如此） |
| `/healthz` | DB 斷線 | 503 | 回 `{status:'error'}` | 是（給監控） |

無「處理方式=無 且 靜默」的 CRITICAL GAP。

## 失敗模式登記表

| 程式碼路徑 | 失敗模式 | 已處理? | 有測試? | 使用者可見? | 恢復路徑 |
|------------|----------|---------|---------|-------------|----------|
| `queries.ts` 報價列表 | innerJoin 讓無網站報價消失 | 第 1 階段改 leftJoin | 是（新增回歸測試） | 是 | — |
| PDF / 信件 / LINE 文字 | site 為 null | `quoteSubjectName()` | 是 | 是 | — |
| migration 0001 | 正式資料舊 notifications 違反新索引 | 舊列 kind 全為 expiry、service_id 非空，與舊索引等價 | 是（global-setup 跑 migration） | 否 | 部署前 `pg_dump` 已有每日備份 |
| 寄送模式切換當下 | 已推出的 LINE 按鈕被拒 | D1：既有設定維持自動寄，部署不改變行為 | 是（切換報價寄送模式.feature + migration 測試：既有列為 true、新庫預設 false） | 是 | 改從後台寄 |
| 排程重跑同一天 | 重複推播 | 部分唯一索引去重 | 是 | 否 | — |
| LINE 對話 | 30 分鐘後才回覆 | expires_at 檢查 | 是 | 是 | 重新點選單 |
| 轉維運 | 送出兩次 | 交易 + `handover_completed_at IS NULL` | 是 | 是 | — |
| 時鐘 | 跨日邊界（台北 vs UTC） | 一律 `today()`（台北） | 是（固定 10:00 台北，另加 00:30 邊界測試） | 否 | — |

## 實作步驟

> 每階段結尾的「驗收」= 該階段 `npm test` 全綠 + `npm run typecheck` + `npm run lint` + `npm run verify` 全綠，可獨立合併與部署。

### 第 0 階段：測試基礎（0.5–1 天，風險中）
1. 安裝 `vitest`、`vite-tsconfig-paths`；建 `vitest.config.mts`（依賴：無）
2. `tests/setup/global-setup.ts`：`TEST_DATABASE_URL` + `assertLocalDatabase` + `_test` 名稱檢查 + 跑 migrations（依賴 1）
3. `tests/setup/per-test.ts`、`tests/fakes/*`、`tests/support/*`（依賴 2）
4. 冒煙測試：`tests/smoke.test.ts` 建一個客戶再讀回來；`今天是("2026-11-16")` 時 `today()` 回 `2026-11-16`
5. `scripts/check-feature-coverage.ts` + `package.json` scripts
6. `.github/workflows/deploy.yml`：verify job 加建立測試庫、`npm test`、`npm run test:coverage-map`（先確認 R9）。D3：兩者失敗即 verify 失敗，`build` / `deploy` 透過 `needs: verify` 被擋下，不加 `continue-on-error`
- 驗收：本機與 CI 都能跑 `npm test`；把 `TEST_DATABASE_URL` 改成非本機或非 `_test` 結尾時測試拒絕啟動（寫成測試）

### 第 1 階段：DB migration + 報價可空相容（1–1.5 天，風險高）
1. 改 `src/db/schema.ts` → `npm run db:generate` 產生 `0001_*.sql`，人工檢查 SQL（尤其索引替換、CHECK、D1 的 UPDATE）；global-setup 加一個 migration 測試：先建 0000 + 一列 settings，再跑 0001，確認該列為 true
2. 加 `src/lib/quote-display.ts`；修 7+2 處：`src/server/queries.ts`（leftJoin、anchorDate 可空）、`src/lib/pdf/render.tsx`、`src/lib/pdf/QuoteDocument.tsx`、`src/lib/quote-message.ts`、`src/server/send-quote.ts`、`src/app/(dashboard)/quotes/[id]/page.tsx`（網站連結 / 錨點日顯示）、`src/app/api/cron/quote-draft/route.ts`
3. `src/server/expiry-scan.ts` 寫入 `kind: 'expiry'`（明確寫，不靠預設）
4. `ActionState.violationType` 擴充
5. 測試：`排程擬定續約報價草稿.feature`（含手動模式推純通知）；回歸測試：無網站報價出現在列表、PDF 可產生
- 驗收：`npm run verify:quotes` 通過；`排程擬定續約報價草稿` 全部 Examples 綠；正式資料副本跑 migration 無錯（本機還原最新備份試跑）
- 對應 feature：`quote/排程擬定續約報價草稿.feature`

### 第 2 階段：專案 + 里程碑 + 專案管理日曆（分兩個 PR）
**2a 專案核心（2–2.5 天，風險中）**
1. `src/server/projects/{create,update,delete,status,list}.ts` + `src/server/actions/projects.ts`
2. `src/server/projects/milestones.ts` + actions
3. `src/lib/gcal.ts` 支援兩個日曆；`src/server/gcal-sync.ts` 每日對帳加入專案 / 里程碑
4. 頁面 `src/app/(dashboard)/projects/{page,new/page,[id]/page}.tsx`；側欄加入口
- 對應 feature：`建立專案`、`編輯專案`、`更新專案狀態`、`查詢專案列表`、`管理專案里程碑`

**2b 轉維運 + 專案報價（1.5–2 天，風險中）**
1. `src/server/projects/handover.ts`（交易：建網站 / 沿用網站設 live、建服務項目、寫 `source_project_id`、`handover_completed_at`）
2. `src/server/projects/quote.ts`（項目手動 / 方案範本、沿用報價序號與有效天數、`site_id` 可空）
3. 專案詳情頁加轉維運表單與「產生報價」
- 對應 feature：`送出轉維運表單`、`從專案產生報價草稿`
- 驗收（2a/2b）：對應 Examples 全綠；日曆 fake 失敗時操作仍成功；`gcal-sync` 補上缺的事件

### 第 3 階段：寄送模式 / 追蹤 / 收款（2–2.5 天，風險高）
1. `src/server/settings/sending-mode.ts` + 設定頁開關、`quote_followup_days` 欄位
2. `src/server/quotes/send.ts`：搶佔式手動寄出（重寫 `send-quote.ts` 的狀態更新順序，供後台與 LINE 共用）
3. `src/app/api/line/webhook/route.ts` postback：依寄送模式分流
4. `src/lib/heartbeat.ts`、`runCronJob()`；`src/app/api/cron/quote-followup/route.ts`
5. `src/server/quotes/payment.ts`（含匯款證明沿用 `quote_attachments`）+ `src/app/api/cron/payment-followup/route.ts`；報價詳情頁加「寄出」「登記收款」
- 對應 feature：`切換報價寄送模式`、`管理者手動寄出報價單`、`管理者在LINE確認報價單`、`排程追蹤未回覆報價`、`登記收款`、`排程追蹤未收款報價`
- 驗收：對應 Examples 全綠；`scripts/verify-webhook.mjs` 仍通過

### 第 4 階段：LINE 查詢與快速新增（2 天，風險中）
1. `src/server/line/query.ts`（近期到期 / 待處理報價 / 進行中專案，各 5 筆 + 後台連結）
2. `src/server/line/quick-add.ts`（狀態機，呼叫 2a 的 `createProject`）
3. webhook `message` / `postback(act=menu|qa)` 分派；非管理者拒絕
4. `scripts/line-richmenu.ts`（D4）：一次性建立 Rich Menu 並設為預設選單；可重跑（先刪同名舊選單再建）；`package.json` 加 `line:richmenu`；圖片放 `scripts/assets/richmenu.png`；README 補執行說明。不納入 CI、不在部署時自動跑
- 對應 feature：`透過LINE查詢資訊`、`透過LINE快速新增專案`
- 驗收：對應 Examples 全綠；以真實 LINE 手動走一次快速新增

### 第 5 階段：週報 / 健康檢查 / 心跳 / 排程設定（1–1.5 天，風險低）
1. `src/server/ops/weekly-report.ts` + `src/app/api/cron/weekly-report/route.ts`
2. ~~健康檢查~~：已完成，`GET /healthz`（`src/app/healthz/route.ts`，已加進 `src/proxy.ts` 公開路徑）。外部監控改打 `/healthz`
3. 既有 5 支 cron（expiry-scan、quote-draft、gcal-sync、detect、uptime）改用 `runCronJob()` 送心跳
4. `src/lib/env.ts`、`.env.example`：`HEARTBEAT_URL`、`HEARTBEAT_TOKEN`（選填）
5. `deploy/systemd/`：新增 `site-manager-cron-{quote-followup,payment-followup,weekly-report}.timer`（09:40 每日、09:45 每日、週一 09:00），沿用 `site-manager-cron@.service`；`deploy/README.md` 排程表同步更新，並寫明 VPS 上要手動 `install` + `systemctl enable --now`（`vps-init.sh` 已移除，部署改照共用 VPS 規格）
- 對應 feature：`排程推送每週週報`、`外部監控查詢系統健康`
- 驗收：全部 120 例綠、`test:coverage-map` 0 缺漏；`curl https://site-manager.ren-codes.com/healthz` 回 200

### 第 6 階段（獨立交付）：PHP 外部監控腳本（1 天，風險低）
- 位置：`tools/php-monitor/`（不進 Next.js 建置；或另開 repo）
- `heartbeat.php`（驗 token、記錄各排程最後 ping 時間到 SQLite / JSON）、`check.php`（cron 每 15 分鐘：逾時門檻 每日 26h / 每週 8 天 / 每小時 3h；`/healthz` 非 200 → LINE push + Email，同問題同日一次）、`config.example.php`、`README.md`
- 測試：PHPUnit 或純 PHP 腳本測門檻計算與去重（不納入 Vitest）
- 依賴：第 5 階段完成（心跳格式定案）
- 驗收：停掉一支排程 26 小時內收到告警；關掉 VPS app 15 分鐘內收到告警；同日不重複

## 測試策略

- 整合測試（主力，D2）：每個 `.feature` 一個 `tests/features/<domain>/<feature名>.test.ts`；`describe(Rule)` / `it(Example 名稱)`，Scenario Outline 用 `it.each(Examples)`
- 單元測試：`quote-display.ts`、`heartbeat.ts`、LINE 對話狀態機、追蹤日期計算
- 回歸：既有 `npm run verify`（不刪除，第 1 階段後持續跑）
- E2E：不做（async Server Component 不支援單元測試；頁面以手動驗收）
- 指令：`npm test`、`npm run test:coverage-map`、`npm run verify`
- 關鍵邊界：台北跨日（00:30）、同日重跑、0 筆待辦、LINE 額度用盡、重複點擊、30 分鐘過期、未綁網站、Google 未授權

## 依賴項目
- 新 devDeps：`vitest`、`vite-tsconfig-paths`
- 本機 Postgres 17 需多建 `site_support_test`
- 外部：LINE Messaging API（Rich Menu）、Google Calendar（需重新授權？—— 沿用既有 scope `calendar`，不需要）、Resend
- PHP 主機（第 6 階段）

## 風險與緩解措施
- **高**：quotes 可空造成既有畫面 / 信件破損 — 第 1 階段集中處理 + typecheck 抓漏 + 回歸測試 + `verify:quotes`
- **低**（已由 D1 消除）：部署當下寄送模式改變 — migration 讓既有設定維持自動寄
- **中**：測試 DB 誤指正式庫 — 雙重守門 + 守門本身有測試
- **中**：重複寄信 / 重複收款 — 條件式 UPDATE 搶佔
- **低**：心跳端點不通拖慢排程 — 5 秒逾時、失敗不拋錯

## 錯誤處理策略
所有 Server Action 回傳 `{ ok, error, violationType }`，violation 只用 api.yml 的 14 種；外部服務失敗一律「不擋主操作 + 記 activity + 有備援就走備援（LINE → Email、日曆 → 每日對帳）」。

## 限制條件（本計劃不做）
- 不做 LINE 上的修改 / 刪除（規格限定查詢 + 快速新增專案）
- 不做多使用者 / 權限
- 不改既有到期提醒門檻與續約草稿規則
- 不做前端 E2E 自動化
- PHP 腳本不進主線 CI
- 不在查詢中使用資料庫 `now()`

## 成功標準
- [ ] 120 個 Examples 皆有對應測試且通過（`test:coverage-map` 0 缺漏）
- [ ] 既有 `npm run verify` 全綠
- [ ] migration 0001 在正式資料副本上成功
- [ ] CI verify job 跑 `npm test` + `test:coverage-map`，失敗會擋部署（D3）
- [ ] VPS 有 8 支排程 + 備份，全部送心跳；`/healthz` 200
- [ ] PHP 監控能在門檻內告警

## 預估複雜度：高（總計約 11–14 個工作天，含 PHP 1 天）

## 已決定事項（2026-11-16 用戶確認）

- **D1 寄送模式**：migration 將既有正式設定設為「LINE 確認後自動寄」（`auto_send_enabled = true`），部署不改變現有行為；新安裝預設值仍依規格為手動寄（false）。
- **D2 測試形式**：手寫 Vitest，`describe` = Rule、`it` 名稱 = Example 名稱（Scenario Outline 用 `it.each`），以 `scripts/check-feature-coverage.ts` 比對查漏。不導入 cucumber 類套件。
- **D3 CI**：`npm test` 或 `test:coverage-map` 失敗即擋住部署。
- **D4 LINE Rich Menu**：附一次性腳本 `scripts/line-richmenu.ts` 建立。

待決問題：無。
