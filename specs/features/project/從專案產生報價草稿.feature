@command
Feature: 從專案產生報價草稿

  在專案頁產生報價草稿，沿用既有報價單 / PDF 流程。

  Background:
    Given 今天是 "2026-11-16"
    And 系統設定為：
      | auto_send_enabled | quote_valid_days |
      | false             | 14               |
    And 系統中有以下客戶：
      | name   | status |
      | 青禾設計 | active |
      | 小森咖啡 | active |
    And 系統中有以下網站：
      | name     | client | status |
      | 小森咖啡官網 | 小森咖啡 | live   |
    And 系統中有以下專案：
      | name       | client | site     | category      | status      | start_date | due_date   | handover_completed_at |
      | 青禾新官網   | 青禾設計 |          | new_site      | not_started |            | 2026-12-31 |                       |
      | 會員集點外掛 | 小森咖啡 | 小森咖啡官網 | custom_plugin | completed   | 2026-10-01 | 2026-10-31 |                       |

  Rule: 前置（參數）- 至少要有一個報價項目；數量必須大於 0，單價必須大於等於 0

    Scenario Outline: 報價項目不合法時操作失敗
      When 管理者從專案 "青禾新官網" 產生報價草稿：
        | description | quantity   | unit | unit_price   |
        | <desc>      | <quantity> | 式   | <unit_price> |
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

      Examples:
        | desc     | quantity | unit_price |
        |          | 1        | 50000      |
        | 官網設計製作 | 0        | 50000      |
        | 官網設計製作 | 1        | -1         |

    Example: 沒有任何報價項目時操作失敗
      When 管理者從專案 "青禾新官網" 產生報價草稿，未填任何項目
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

  Rule: 前置（狀態）- 專案任何狀態都可產生報價草稿；一個專案可有多張報價單

    Scenario Outline: 不同狀態的專案都能產生報價草稿
      When 管理者從專案 "<project>" 產生報價草稿：
        | description | quantity | unit | unit_price |
        | 追加功能     | 1        | 式   | 8000       |
      Then 操作成功

      Examples:
        | project    |
        | 青禾新官網   |
        | 會員集點外掛 |

    Example: 已有報價單的專案可再產生一張
      Given 系統中有以下報價單：
        | quote_no | client | site | project  | status | sent_at                   | accepted_at | anchor_date | valid_until | total  | paid_on |
        | 261105   | 青禾設計 |      | 青禾新官網 | sent   | 2026-11-05T10:00:00+08:00 |             |             | 2026-11-19  | 126000 |         |
      When 管理者從專案 "青禾新官網" 產生報價草稿：
        | description | quantity | unit | unit_price |
        | 追加多語系   | 1        | 式   | 15000      |
      Then 操作成功
      And 專案 "青禾新官網" 應有 2 張報價單

  Rule: 前置（參數）- 報價項目由管理者手動輸入（說明、數量、單位、單價），可從方案範本帶入後調整

    Example: 從方案範本帶入的項目可調整單價
      Given 系統中有以下方案範本：
        | name   | type    | spec_note   | price_amount |
        | 基本方案 | hosting | 空間 10GB   | 6000         |
      When 管理者從專案 "青禾新官網" 產生報價草稿：
        | description | quantity | unit | unit_price | from_plan |
        | 主機 基本方案 | 1        | 年   | 5400       | 基本方案    |
      Then 操作成功
      And 專案 "青禾新官網" 最新一張報價單應有以下項目：
        | description | spec_note | quantity | unit | unit_price | amount |
        | 主機 基本方案 | 空間 10GB | 1        | 年   | 5400       | 5400   |

  Rule: 後置（狀態）- 報價單綁定專案的客戶；專案有綁網站時一併綁定，否則網站留空

    Scenario Outline: 產生的報價單客戶與網站正確
      When 管理者從專案 "<project>" 產生報價草稿：
        | description | quantity | unit | unit_price |
        | 專案費用     | 1        | 式   | 50000      |
      Then 操作成功
      And 專案 "<project>" 最新一張報價單應為：
        | client   | site   | anchor_date | subtotal |
        | <client> | <site> |             | 50000    |

      Examples:
        | project    | client | site     |
        | 青禾新官網   | 青禾設計 |          |
        | 會員集點外掛 | 小森咖啡 | 小森咖啡官網 |

  Rule: 後置（狀態）- 專案名稱帶入報價單的專案名稱欄位

    Example: 報價單的專案名稱為專案名稱
      When 管理者從專案 "青禾新官網" 產生報價草稿：
        | description | quantity | unit | unit_price |
        | 官網設計製作 | 1        | 式   | 50000      |
      Then 專案 "青禾新官網" 最新一張報價單應為：
        | project_name |
        | 青禾新官網     |

  Rule: 後置（狀態）- 產生的報價單為草稿，寄送依報價寄送模式（手動寄 / LINE 確認後自動寄）

    Example: 產生的報價單為草稿且有效期限依設定
      When 管理者從專案 "青禾新官網" 產生報價草稿：
        | description | quantity | unit | unit_price |
        | 官網設計製作 | 1        | 式   | 50000      |
      Then 專案 "青禾新官網" 最新一張報價單應為：
        | status | issue_date | valid_until |
        | draft  | 2026-11-16 | 2026-11-30  |
      And 不應推播任何 LINE 訊息

  Rule: 後置（狀態）- 未綁網站的報價單，PDF、LINE 確認訊息與 Email 以專案名稱取代網站名稱

    Example: 未綁網站的報價單 PDF 顯示專案名稱
      When 管理者從專案 "青禾新官網" 產生報價草稿：
        | description | quantity | unit | unit_price |
        | 官網設計製作 | 1        | 式   | 50000      |
      Then 專案 "青禾新官網" 最新一張報價單的 PDF 應包含文字 "青禾新官網"
