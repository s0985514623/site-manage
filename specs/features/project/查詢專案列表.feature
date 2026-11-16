@query
Feature: 查詢專案列表

  Background:
    Given 今天是 "2026-11-16"
    And 系統中有以下客戶：
      | name   | status |
      | 青禾設計 | active |
      | 小森咖啡 | active |
    And 系統中有以下專案：
      | name       | client | site | category      | status      | start_date | due_date   | handover_completed_at |
      | 青禾新官網   | 青禾設計 |      | new_site      | in_progress | 2026-11-01 | 2026-12-31 |                       |
      | 會員集點外掛 | 小森咖啡 |      | custom_plugin | in_review   | 2026-10-01 | 2026-11-10 |                       |
      | 結帳頁修正   | 小森咖啡 |      | bug_fix       | completed   | 2026-10-20 | 2026-10-25 |                       |
      | 年度健檢     | 青禾設計 |      | other         | not_started |            |            |                       |

  Rule: 後置（回應）- 可依類別篩選

    Example: 只看客製化外掛類別
      When 管理者查詢專案列表：
        | category      | status |
        | custom_plugin |        |
      Then 查詢結果應為：
        | name       |
        | 會員集點外掛 |

  Rule: 後置（回應）- 可依狀態篩選

    Example: 只看已完成的專案
      When 管理者查詢專案列表：
        | category | status    |
        |          | completed |
      Then 查詢結果應為：
        | name     |
        | 結帳頁修正 |

  Rule: 後置（回應）- 顯示客戶、專案名稱、類別、狀態、截止日；預設依截止日由近到遠，未設截止日排最後

    Example: 不篩選時依截止日排序
      When 管理者查詢專案列表：
        | category | status |
        |          |        |
      Then 查詢結果應為：
        | client | name       | category      | status      | due_date   |
        | 小森咖啡 | 結帳頁修正   | bug_fix       | completed   | 2026-10-25 |
        | 小森咖啡 | 會員集點外掛 | custom_plugin | in_review   | 2026-11-10 |
        | 青禾設計 | 青禾新官網   | new_site      | in_progress | 2026-12-31 |
        | 青禾設計 | 年度健檢     | other         | not_started |            |

  Rule: 後置（回應）- 已逾截止日且未完成的專案標示為逾期

    Example: 逾期且未完成的專案被標示
      When 管理者查詢專案列表：
        | category | status |
        |          |        |
      Then 查詢結果應為：
        | name       | overdue |
        | 結帳頁修正   | false   |
        | 會員集點外掛 | true    |
        | 青禾新官網   | false   |
        | 年度健檢     | false   |
