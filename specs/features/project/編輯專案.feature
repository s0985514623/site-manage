@command
Feature: 編輯專案

  管理者在網頁後台修改或刪除專案（狀態變更見 更新專案狀態.feature）。

  Background:
    Given 今天是 "2026-11-16"
    And 系統中有以下客戶：
      | name   | status |
      | 青禾設計 | active |
      | 小森咖啡 | active |
    And 系統中有以下網站：
      | name     | client | status |
      | 小森咖啡官網 | 小森咖啡 | live   |
    And 系統中有以下專案：
      | name     | client | site | category | status      | start_date | due_date   | handover_completed_at |
      | 青禾新官網 | 青禾設計 |      | new_site | in_progress | 2026-11-01 | 2026-12-31 |                       |
    And 專案 "青禾新官網" 在「專案管理」日曆有截止日事件

  Rule: 前置（參數）- 可修改的欄位與驗證規則與建立專案相同

    Scenario Outline: 修改內容不合法時操作失敗
      When 管理者編輯專案 "青禾新官網"：
        | name   | site   | start_date   | due_date   |
        | <name> | <site> | <start_date> | <due_date> |
      Then 操作失敗，violation_type 為 "<violation>"

      Examples:
        | name     | site     | start_date | due_date   | violation            |
        |          |          | 2026-11-01 | 2026-12-31 | INVALID_ARGUMENT     |
        | 青禾新官網 |          | 2026-11-01 | 2026-10-31 | INVALID_DATE_RANGE   |
        | 青禾新官網 | 小森咖啡官網 | 2026-11-01 | 2026-12-31 | SITE_CLIENT_MISMATCH |

    Example: 專案不存在時操作失敗
      When 管理者編輯專案 "不存在的專案"：
        | name | site | start_date | due_date |
        | 改名 |      |            |          |
      Then 操作失敗，violation_type 為 "NOT_FOUND"

  Rule: 後置（狀態）- 截止日新增、變更或清除時，同步新增、更新或刪除「專案管理」日曆事件

    Example: 變更截止日後日曆事件日期同步更新
      When 管理者編輯專案 "青禾新官網"：
        | name     | site | start_date | due_date   |
        | 青禾新官網 |      | 2026-11-01 | 2027-01-15 |
      Then 操作成功
      And 「專案管理」日曆應有以下事件：
        | title                  | date       |
        | 【專案截止】青禾設計 · 青禾新官網 | 2027-01-15 |

    Example: 清除截止日後日曆事件被刪除
      When 管理者編輯專案 "青禾新官網"：
        | name     | site | start_date | due_date |
        | 青禾新官網 |      | 2026-11-01 |          |
      Then 操作成功
      And 「專案管理」日曆不應有任何事件

  Rule: 前置（狀態）- 專案已有報價單時禁止刪除

    Example: 有報價單的專案無法刪除
      Given 系統中有以下報價單：
        | quote_no | client | site | project  | status | sent_at | accepted_at | anchor_date | valid_until | total  | paid_on |
        | 261105   | 青禾設計 |      | 青禾新官網 | draft  |         |             |             | 2026-11-19  | 120000 |         |
      When 管理者刪除專案 "青禾新官網"
      Then 操作失敗，violation_type 為 "PROJECT_HAS_QUOTES"

  Rule: 後置（狀態）- 刪除專案時一併刪除其里程碑與對應的「專案管理」日曆事件

    Example: 刪除專案後里程碑與日曆事件一併移除
      Given 系統中有以下里程碑：
        | project  | name     | due_on     | completed_at |
        | 青禾新官網 | 設計稿確認 | 2026-11-25 |              |
      When 管理者刪除專案 "青禾新官網"
      Then 操作成功
      And 專案 "青禾新官網" 應不存在
      And 「專案管理」日曆不應有任何事件
