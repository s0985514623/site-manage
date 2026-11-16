@command
Feature: 建立專案

  管理者在網頁後台建立專案。

  Background:
    Given 今天是 "2026-11-16"
    And 系統中有以下客戶：
      | name   | status   |
      | 青禾設計 | active   |
      | 小森咖啡 | active   |
      | 停用客戶 | inactive |
    And 系統中有以下網站：
      | name     | client | status |
      | 小森咖啡官網 | 小森咖啡 | live   |

  Rule: 前置（參數）- 專案類別必須為 新網站、客製化外掛、BUG 排除、其他 其中之一

    Example: 類別不在清單內時操作失敗
      When 管理者建立專案：
        | name     | client | category | site | start_date | due_date   | estimated_amount |
        | 官網改版 | 青禾設計 | 網站改版 |      |            | 2026-12-31 |                  |
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

  Rule: 前置（參數）- 必填：專案名稱、客戶、類別；選填：網站、開始日、截止日、說明、預估金額

    Scenario Outline: 缺少必填欄位時操作失敗
      When 管理者建立專案：
        | name   | client   | category   | site | start_date | due_date | estimated_amount |
        | <name> | <client> | <category> |      |            |          |                  |
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

      Examples:
        | name     | client | category |
        |          | 青禾設計 | new_site |
        | 青禾新官網 |        | new_site |
        | 青禾新官網 | 青禾設計 |          |

  Rule: 前置（參數）- 專案名稱不可為空白

    Example: 名稱只有空白時操作失敗
      When 管理者建立專案：
        | name | client | category | site | start_date | due_date | estimated_amount |
        | "  " | 青禾設計 | new_site |      |            |          |                  |
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

  Rule: 前置（參數）- 同時填寫開始日與截止日時，截止日不可早於開始日

    Example: 截止日早於開始日時操作失敗
      When 管理者建立專案：
        | name     | client | category | site | start_date | due_date   | estimated_amount |
        | 青禾新官網 | 青禾設計 | new_site |      | 2026-12-01 | 2026-11-30 |                  |
      Then 操作失敗，violation_type 為 "INVALID_DATE_RANGE"

  Rule: 前置（參數）- 預估金額有填時必須大於等於 0

    Example: 預估金額為負數時操作失敗
      When 管理者建立專案：
        | name     | client | category | site | start_date | due_date | estimated_amount |
        | 青禾新官網 | 青禾設計 | new_site |      |            |          | -1               |
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

  Rule: 前置（參數）- 指定網站時，網站必須屬於同一客戶

    Example: 網站屬於其他客戶時操作失敗
      When 管理者建立專案：
        | name     | client | category | site     | start_date | due_date | estimated_amount |
        | 修正表單 | 青禾設計 | bug_fix  | 小森咖啡官網 |            |          |                  |
      Then 操作失敗，violation_type 為 "SITE_CLIENT_MISMATCH"

  Rule: 前置（狀態）- 客戶必須存在且為啟用狀態

    Scenario Outline: 客戶不存在或已停用時操作失敗
      When 管理者建立專案：
        | name     | client   | category | site | start_date | due_date | estimated_amount |
        | 新專案   | <client> | other    |      |            |          |                  |
      Then 操作失敗，violation_type 為 "<violation>"

      Examples:
        | client   | violation       |
        | 不存在客戶 | NOT_FOUND       |
        | 停用客戶   | CLIENT_INACTIVE |

  Rule: 後置（狀態）- 新專案狀態為「待開始」

    Scenario Outline: 各類別專案建立後狀態為待開始
      When 管理者建立專案：
        | name   | client   | category   | site   | start_date | due_date   | estimated_amount |
        | <name> | <client> | <category> | <site> | 2026-11-20 | 2026-12-31 | 60000            |
      Then 操作成功
      And 專案 "<name>" 應為：
        | client   | category   | site   | status      | due_date   |
        | <client> | <category> | <site> | not_started | 2026-12-31 |

      Examples:
        | name       | client | category      | site     |
        | 青禾新官網   | 青禾設計 | new_site      |          |
        | 會員集點外掛 | 小森咖啡 | custom_plugin | 小森咖啡官網 |
        | 結帳頁修正   | 小森咖啡 | bug_fix       | 小森咖啡官網 |
        | 年度健檢     | 小森咖啡 | other         |          |

  Rule: 後置（狀態）- 有截止日時寫入「專案管理」Google 日曆（單向，與「網站到期管理」日曆分開）；日曆不存在時自動建立

    Example: 有截止日的專案寫入專案管理日曆
      When 管理者建立專案：
        | name     | client | category | site | start_date | due_date   | estimated_amount |
        | 青禾新官網 | 青禾設計 | new_site |      | 2026-11-20 | 2026-12-31 |                  |
      Then 「專案管理」日曆應有以下事件：
        | title                  | date       |
        | 【專案截止】青禾設計 · 青禾新官網 | 2026-12-31 |

    Example: 沒有截止日的專案不建立日曆事件
      When 管理者建立專案：
        | name     | client | category | site | start_date | due_date | estimated_amount |
        | 年度健檢 | 青禾設計 | other    |      |            |          |                  |
      Then 「專案管理」日曆不應有任何事件

  Rule: 後置（狀態）- 日曆同步失敗不阻擋建立，由每日對帳補上

    Example: 日曆無法連線時專案仍建立成功
      Given Google 日曆無法連線
      When 管理者建立專案：
        | name     | client | category | site | start_date | due_date   | estimated_amount |
        | 青禾新官網 | 青禾設計 | new_site |      |            | 2026-12-31 |                  |
      Then 操作成功
      And 專案 "青禾新官網" 應為：
        | status      | gcal_event_id |
        | not_started |               |
