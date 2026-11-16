# Execution Plan — 專案管理 / LINE 操作 / 防遺漏自動化

> 狀態：Phase 01–04 規格完成（CiC = 0）。產出：specs/entity/erm.dbml、specs/features/**（含 Examples）、specs/api/api.yml。下一步交 planner。
> 起始狀態：既有系統（程式已存在，specs 為 greenfield）。只規格化本次新增 / 變更的行為。

## 概覽
| 類型 | 數量 |
|------|------|
| Create | 18 個 .feature（含 Examples）、4 個 activity、3 個 actor、7 份句型 / 系統抽象 |
| Modify（既有程式行為） | 5 處：quote-draft、LINE webhook、settings、quotes.site_id 可空、既有 5 支排程加心跳 ping |
| Delete | 0 |

## Phase 02: Entity Modeling
| 操作 | 目標 | 說明 |
|------|------|------|
| create | projects | 客戶（必）、類別（必）、網站（選）、名稱、開始/截止日、說明、預估金額、狀態、轉維運完成時間 |
| create | project_milestones | 名稱、日期、完成、gcal_event_id |
| create | project_category enum | new_site / custom_plugin / bug_fix / other |
| create | project_status enum | 待開始 / 進行中 / 待驗收 / 已完成 |
| create | LINE 對話狀態 | 快速新增專案的逐步問答暫存（30 分鐘過期） |
| modify | settings | 自動寄信開關（預設關）、未回覆追蹤天數（預設 7）、gcal_project_calendar_id（「專案管理」日曆） |
| modify | quotes | **site_id 改為可空**、新增 project_id（可空）、收款日 / 實收金額（sent_at 已存在） |

## ⚠ quotes.site_id 改為可空的影響範圍（Q9）
| 位置 | 依賴 | 處理 |
|------|------|------|
| `src/db/schema.ts` quotes.siteId | `.notNull()`、`quotes_site_idx` | 移除 notNull，需 migration |
| `src/server/queries.ts:118` | `innerJoin(sites, quotes.siteId)` | 改 leftJoin，否則未綁網站的報價單在列表消失 |
| `src/lib/pdf/render.tsx:42`、`QuoteDocument.tsx` | `quote.site.name` → siteName | 為空時改用專案名稱 |
| `src/lib/quote-message.ts:104,137` | LINE altText 與「網站」列 | 為空時改顯示專案名稱 |
| `src/server/send-quote.ts:35,65,70,79` | Email 主旨與內文「續約報價單」 | 為空時改用專案名稱，措辭不寫「續約」 |
| `src/app/(dashboard)/quotes/[id]/page.tsx:139` | `/sites/${siteId}` 連結 | 為空時改連到專案頁 |
| `src/lib/quote-builder.ts` | 以網站分組擬續約草稿 | 不受影響（續約草稿一定有網站），需回歸 `verify:quotes` |

## Phase 03: BDD Analysis
| 操作 | 目標 | 說明 |
|------|------|------|
| create | project/ | 建立、編輯、更新狀態（含轉維運表單）、里程碑、列表、產生報價 |
| create | quote/、payment/ | 手動寄出、未回覆追蹤、登記收款、未收款追蹤 |
| modify | quote/ | 排程擬定草稿、LINE 確認（加寄送模式判斷） |
| create | line/、ops/、settings/ | LINE 查詢 / 快速新增、週報、排程健康、寄送模式 |

## Phase 04: API Contract
| 操作 | 目標 | 說明 |
|------|------|------|
| create | 專案、里程碑、轉維運、寄出、收款的 Server Actions | 沿用既有 `src/server/actions/*` 慣例 |
| create | /api/cron/quote-followup、payment-followup、weekly-report | 新排程端點 |
| create | GET /api/health | 外部監控用，200 / 503 |
| modify | /api/line/webhook | 加入 message 查詢 / 快速新增處理 |

## Phase 05-07: Implementation
| 操作 | 目標 | 說明 |
|------|------|------|
| red-green-refactor | 上述所有 .feature | 沿用 verify:* 腳本或導入測試框架（待 planner 決定） |
| modify | scripts/vps-init.sh | crontab 新增 4 個排程 |
| modify | gcal.ts / gcal-sync | 另建「專案管理」日曆；專案截止日與里程碑事件；每日對帳 |
| modify | src/lib/cron.ts | 排程成功後 ping 心跳（新 3 支 + 既有 expiry-scan、quote-draft、gcal-sync、detect、uptime） |
| modify | .env.example、env.ts | HEARTBEAT_URL、HEARTBEAT_TOKEN |

## 獨立交付物：PHP 外部監控腳本（不在本 repo 主要範圍）
| 項目 | 說明 |
|------|------|
| 心跳接收端點 | 驗證心跳 token，記錄各排程最後 ping 時間 |
| 檢查腳本（PHP 主機 cron 每 15 分鐘） | 心跳逾時（每日 26h / 每週 8 天 / 每小時 3h）或 VPS /api/health 非 200 → 告警 |
| 告警 | 同時發 LINE push + Email；同一問題同日只告警一次 |
| 需要的設定 | 心跳 token（與 VPS 共用）、LINE channel access token + 接收者 userId、告警 Email、VPS health URL、各排程名稱與門檻 |

## Phase 02–04 完成紀錄
- erm.dbml：新增 projects、project_milestones、line_conversations 與 4 個 enum；修改 quotes（site_id / anchor_date 可空、project_id、accepted_at、paid_on、paid_amount）、settings（auto_send_enabled、quote_followup_days、gcal_project_calendar_id）、notifications（kind、quote_id、service_id 可空）、services（source_project_id）
- features：120 個 Example / Outline，句型見各 domain 句型.md；共用句型在 features/系統抽象.md
- api.yml：17 個 path；cron / health / LINE webhook 為真實路由，其餘為 Server Action 邏輯契約（x-implementation）
- 錯誤回傳：ActionState 擴充 violationType（14 種，見 api.yml ViolationType）
- 測試需要的 fake：時鐘（固定 10:00 台北）、LINE gateway、Resend、Google Calendar、心跳端點
