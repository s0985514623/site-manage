@command
Feature: 排程推送每週週報

  每週一 09:00 推一則 LINE 週報。

  Background:
    Given 今天是 "2026-11-16"
    And 系統設定為：
      | line_admin_configured |
      | true                  |
    And 系統中有以下客戶：
      | name   | status |
      | 小森咖啡 | active |
      | 青禾設計 | active |
    And 系統中有以下網站：
      | name     | client | status |
      | 小森咖啡官網 | 小森咖啡 | live   |

  Rule: 後置（回應）- 週報內容：本週到期項目、待處理報價（待確認 / 未回覆 / 未收款）、本週專案截止日與里程碑

    Example: 週報彙整本週三類待辦
      Given 系統中有以下服務項目：
        | site     | type    | identifier     | expires_at | price_amount | status |
        | 小森咖啡官網 | domain  | morimori.com.tw | 2026-11-20 | 1200         | active |
        | 小森咖啡官網 | hosting | 基本方案         | 2026-11-24 | 6000         | active |
      And 系統中有以下報價單：
        | quote_no | client | site     | project | status | sent_at                   | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261109   | 小森咖啡 | 小森咖啡官網 |         | sent   | 2026-11-09T10:00:00+08:00 |             | 2026-12-20  | 2026-11-23  | 8400  |         |
      And 系統中有以下專案：
        | name     | client | site | category | status      | start_date | due_date   | handover_completed_at |
        | 青禾新官網 | 青禾設計 |      | new_site | in_progress | 2026-11-01 | 2026-11-21 |                       |
      And 系統中有以下里程碑：
        | project  | name     | due_on     | completed_at |
        | 青禾新官網 | 設計稿確認 | 2026-11-18 |              |
      When 排程執行「weekly-report」
      Then LINE 應推播給管理者以下訊息：
        | kind | contains                    |
        | 週報 | 本週到期：morimori.com.tw 11/20 |
        | 週報 | 未回覆報價：261109              |
        | 週報 | 專案截止：青禾新官網 11/21        |
        | 週報 | 里程碑：設計稿確認 11/18          |
      And LINE 推播給管理者的訊息數應為 1
      And LINE 推播內容不應包含 "基本方案"

  Rule: 後置（回應）- 與本週重疊的時程（開始日或結束日落在本週、或橫跨本週）列在「時程」

    Example: 本週進行中的時程列入週報
      Given 系統中有以下專案：
        | name     | client | site | category | status      | start_date | due_date   | handover_completed_at |
        | 青禾新官網 | 青禾設計 |      | new_site | in_progress | 2026-11-01 | 2026-12-31 |                       |
      And 系統中有以下里程碑：
        | project  | name   | start_on   | due_on     | completed_at |
        | 青禾新官網 | 前端開發 | 2026-11-10 | 2026-12-10 |              |
        | 青禾新官網 | 上線準備 | 2026-12-15 | 2026-12-20 |              |
      When 排程執行「weekly-report」
      Then LINE 應推播給管理者以下訊息：
        | kind | contains                    |
        | 週報 | 時程：前端開發 11/10–12/10 |
      And LINE 推播內容不應包含 "上線準備"

  Rule: 後置（狀態）- 無任何待處理事項時仍推送「本週無待辦」，兼作系統存活訊號

    Example: 沒有待辦時推送本週無待辦
      When 排程執行「weekly-report」
      Then LINE 應推播給管理者以下訊息：
        | kind | contains |
        | 週報 | 本週無待辦 |

  Rule: 後置（狀態）- LINE 推播額度不足時改寄 Email

    Example: 推播額度用完時週報改寄 Email
      Given LINE 本月推播額度已用完
      When 排程執行「weekly-report」
      Then 不應推播任何 LINE 訊息
      And 應寄出以下 Email：
        | to     | subject_contains |
        | 管理者 | 每週週報         |

  Rule: 後置（連鎖）- 執行成功後 ping 外部監控主機的心跳端點；ping 失敗不影響本次排程結果

    Example: 週報推送後送出心跳
      When 排程執行「weekly-report」
      Then 心跳端點應收到以下 ping：
        | job           |
        | weekly-report |

    Example: 同一天重跑週報不重複推送
      Given 系統中有以下通知紀錄：
        | kind          | quote | channel | sent_on    |
        | weekly_report |       | line    | 2026-11-16 |
      When 排程執行「weekly-report」
      Then 不應推播任何 LINE 訊息
      And 心跳端點應收到以下 ping：
        | job           |
        | weekly-report |
