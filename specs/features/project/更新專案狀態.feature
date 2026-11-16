@command
Feature: 更新專案狀態

  所有類別共用狀態：待開始 → 進行中 → 待驗收 → 已完成。類別只作標籤與篩選。
  轉維運表單的內容與送出見 送出轉維運表單.feature（Discovery 後拆出的獨立操作）。

  Background:
    Given 今天是 "2026-11-16"
    And 系統中有以下客戶：
      | name   | status |
      | 青禾設計 | active |

  Rule: 前置（參數）- 新狀態必須為 待開始、進行中、待驗收、已完成 其中之一

    Example: 狀態不在清單內時操作失敗
      Given 系統中有以下專案：
        | name     | client | site | category | status      | start_date | due_date   | handover_completed_at |
        | 青禾新官網 | 青禾設計 |      | new_site | in_progress | 2026-11-01 | 2026-12-31 |                       |
      When 管理者更新專案 "青禾新官網" 的狀態為 "cancelled"
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

  Rule: 前置（狀態）- 四個狀態之間可任意切換

    Scenario Outline: 任意狀態切換皆成功
      Given 系統中有以下專案：
        | name       | client | site | category      | status | start_date | due_date   | handover_completed_at |
        | 會員集點外掛 | 青禾設計 |      | custom_plugin | <from> | 2026-11-01 | 2026-12-31 |                       |
      When 管理者更新專案 "會員集點外掛" 的狀態為 "<to>"
      Then 操作成功
      And 專案 "會員集點外掛" 應為：
        | status |
        | <to>   |

      Examples:
        | from        | to          |
        | not_started | in_progress |
        | in_review   | in_progress |
        | not_started | completed   |
        | completed   | in_review   |

  Rule: 後置（連鎖）- 「新網站」類別專案第一次變為「已完成」時，顯示轉維運表單

    Example: 新網站專案第一次完成時要求轉維運
      Given 系統中有以下專案：
        | name     | client | site | category | status    | start_date | due_date   | handover_completed_at |
        | 青禾新官網 | 青禾設計 |      | new_site | in_review | 2026-11-01 | 2026-12-31 |                       |
      When 管理者更新專案 "青禾新官網" 的狀態為 "completed"
      Then 操作成功
      And 回應應為：
        | status    | handover_required |
        | completed | true              |

  Rule: 後置（連鎖）- 轉維運只執行一次；已完成轉維運的專案再次變為已完成時不再顯示表單

    Example: 已轉維運的新網站專案再次完成不再要求
      Given 系統中有以下專案：
        | name     | client | site | category | status    | start_date | due_date   | handover_completed_at     |
        | 青禾新官網 | 青禾設計 |      | new_site | in_review | 2026-11-01 | 2026-12-31 | 2026-11-10T10:00:00+08:00 |
      When 管理者更新專案 "青禾新官網" 的狀態為 "completed"
      Then 回應應為：
        | status    | handover_required |
        | completed | false             |

  Rule: 後置（狀態）- 非「新網站」類別完成時不顯示轉維運表單

    Scenario Outline: 非新網站類別完成時不要求轉維運
      Given 系統中有以下專案：
        | name   | client | site | category   | status    | start_date | due_date   | handover_completed_at |
        | <name> | 青禾設計 |      | <category> | in_review | 2026-11-01 | 2026-12-31 |                       |
      When 管理者更新專案 "<name>" 的狀態為 "completed"
      Then 回應應為：
        | status    | handover_required |
        | completed | false             |

      Examples:
        | name       | category      |
        | 會員集點外掛 | custom_plugin |
        | 結帳頁修正   | bug_fix       |
        | 年度健檢     | other         |
