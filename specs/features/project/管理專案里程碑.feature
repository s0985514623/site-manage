@command
Feature: 管理專案里程碑

  每個專案可有多個自訂里程碑（名稱 + 日期），每個都寫入「專案管理」Google 日曆。

  Background:
    Given 今天是 "2026-11-16"
    And 系統中有以下客戶：
      | name   | status |
      | 青禾設計 | active |
    And 系統中有以下專案：
      | name     | client | site | category | status      | start_date | due_date | handover_completed_at |
      | 青禾新官網 | 青禾設計 |      | new_site | in_progress | 2026-11-01 |          |                       |

  Rule: 前置（參數）- 里程碑必填名稱與日期，名稱不可為空白

    Scenario Outline: 里程碑資料不合法時操作失敗
      When 管理者為專案 "青禾新官網" 新增里程碑：
        | name   | due_on   |
        | <name> | <due_on> |
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

      Examples:
        | name     | due_on     |
        |          | 2026-11-25 |
        | "  "     | 2026-11-25 |
        | 設計稿確認 |            |

  Rule: 前置（狀態）- 所屬專案必須存在

    Example: 專案不存在時無法新增里程碑
      When 管理者為專案 "不存在的專案" 新增里程碑：
        | name     | due_on     |
        | 設計稿確認 | 2026-11-25 |
      Then 操作失敗，violation_type 為 "NOT_FOUND"

  Rule: 後置（狀態）- 新增或修改里程碑時同步寫入「專案管理」日曆（單向）；同步失敗不阻擋存檔，由每日對帳補上

    Example: 新增里程碑後寫入專案管理日曆
      When 管理者為專案 "青禾新官網" 新增里程碑：
        | name     | due_on     |
        | 設計稿確認 | 2026-11-25 |
      Then 操作成功
      And 「專案管理」日曆應有以下事件：
        | title                         | date       |
        | 【里程碑】青禾設計 · 青禾新官網 · 設計稿確認 | 2026-11-25 |

    Example: 修改里程碑日期後日曆事件同步更新
      Given 系統中有以下里程碑：
        | project  | name     | due_on     | completed_at |
        | 青禾新官網 | 設計稿確認 | 2026-11-25 |              |
      And 里程碑 "設計稿確認" 在「專案管理」日曆有事件
      When 管理者修改里程碑 "設計稿確認"：
        | name     | due_on     |
        | 設計稿確認 | 2026-11-28 |
      Then 操作成功
      And 「專案管理」日曆應有以下事件：
        | title                         | date       |
        | 【里程碑】青禾設計 · 青禾新官網 · 設計稿確認 | 2026-11-28 |

    Example: 日曆無法連線時里程碑仍新增成功
      Given Google 日曆無法連線
      When 管理者為專案 "青禾新官網" 新增里程碑：
        | name     | due_on     |
        | 設計稿確認 | 2026-11-25 |
      Then 操作成功
      And 專案 "青禾新官網" 應有以下里程碑：
        | name     | due_on     | gcal_event_id |
        | 設計稿確認 | 2026-11-25 |               |

  Rule: 後置（狀態）- 刪除里程碑時同步刪除「專案管理」日曆事件

    Example: 刪除里程碑後日曆事件被移除
      Given 系統中有以下里程碑：
        | project  | name     | due_on     | completed_at |
        | 青禾新官網 | 設計稿確認 | 2026-11-25 |              |
      And 里程碑 "設計稿確認" 在「專案管理」日曆有事件
      When 管理者刪除里程碑 "設計稿確認"
      Then 操作成功
      And 「專案管理」日曆不應有任何事件

  Rule: 後置（狀態）- 里程碑可標記完成；里程碑完成或專案完成後，日曆事件保留不刪

    Example: 標記里程碑完成後日曆事件保留
      Given 系統中有以下里程碑：
        | project  | name     | due_on     | completed_at |
        | 青禾新官網 | 設計稿確認 | 2026-11-15 |              |
      And 里程碑 "設計稿確認" 在「專案管理」日曆有事件
      When 管理者將里程碑 "設計稿確認" 標記為完成
      Then 操作成功
      And 專案 "青禾新官網" 應有以下里程碑：
        | name     | completed_at              |
        | 設計稿確認 | 2026-11-16T10:00:00+08:00 |
      And 「專案管理」日曆應有以下事件：
        | title                         | date       |
        | 【里程碑】青禾設計 · 青禾新官網 · 設計稿確認 | 2026-11-15 |
