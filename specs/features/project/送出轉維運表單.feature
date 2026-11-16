@command
Feature: 送出轉維運表單

  「新網站」專案完成後，管理者勾選要建立的服務項目並填寫到期日與售價，送出後建立維運資料。

  Background:
    Given 今天是 "2026-11-16"
    And 系統中有以下客戶：
      | name   | status |
      | 青禾設計 | active |
    And 系統中有以下網站：
      | name   | client | status   |
      | 青禾舊站 | 青禾設計 | building |

  Rule: 前置（狀態）- 專案必須為「新網站」類別、狀態為「已完成」，且尚未轉維運

    Scenario Outline: 不符合轉維運條件時操作失敗
      Given 系統中有以下專案：
        | name   | client | site | category   | status   | start_date | due_date   | handover_completed_at |
        | <name> | 青禾設計 |      | <category> | <status> | 2026-11-01 | 2026-12-31 | <handover>            |
      When 管理者送出專案 "<name>" 的轉維運表單：
        | type   | identifier     | expires_at | price_amount | billing_cycle |
        | domain | qinghe.design  | 2027-11-16 | 1200         | yearly        |
      Then 操作失敗，violation_type 為 "HANDOVER_NOT_ALLOWED"

      Examples:
        | name       | category      | status      | handover                  |
        | 會員集點外掛 | custom_plugin | completed   |                           |
        | 青禾新官網   | new_site      | in_progress |                           |
        | 青禾新官網   | new_site      | completed   | 2026-11-10T10:00:00+08:00 |

  Rule: 前置（參數）- 至少勾選一項；每項必填類型、識別名稱、到期日、售價；售價必須大於等於 0；計費週期預設每年

    Scenario Outline: 服務項目資料不合法時操作失敗
      Given 系統中有以下專案：
        | name     | client | site | category | status    | start_date | due_date   | handover_completed_at |
        | 青禾新官網 | 青禾設計 |      | new_site | completed | 2026-11-01 | 2026-12-31 |                       |
      When 管理者送出專案 "青禾新官網" 的轉維運表單：
        | type   | identifier   | expires_at   | price_amount | billing_cycle |
        | <type> | <identifier> | <expires_at> | <price>      | yearly        |
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

      Examples:
        | type    | identifier    | expires_at | price |
        | website | qinghe.design | 2027-11-16 | 1200  |
        | domain  |               | 2027-11-16 | 1200  |
        | domain  | qinghe.design |            | 1200  |
        | domain  | qinghe.design | 2027-11-16 |       |
        | domain  | qinghe.design | 2027-11-16 | -1    |

    Example: 沒有勾選任何服務項目時操作失敗
      Given 系統中有以下專案：
        | name     | client | site | category | status    | start_date | due_date   | handover_completed_at |
        | 青禾新官網 | 青禾設計 |      | new_site | completed | 2026-11-01 | 2026-12-31 |                       |
      When 管理者送出專案 "青禾新官網" 的轉維運表單，未勾選任何服務項目
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

  Rule: 後置（連鎖）- 專案未綁網站時先建立網站並綁定到專案，網站名稱預設帶專案名稱，狀態為「已上線」

    Example: 未綁網站的專案轉維運時建立新網站
      Given 系統中有以下專案：
        | name     | client | site | category | status    | start_date | due_date   | handover_completed_at |
        | 青禾新官網 | 青禾設計 |      | new_site | completed | 2026-11-01 | 2026-12-31 |                       |
      When 管理者送出專案 "青禾新官網" 的轉維運表單：
        | type    | identifier    | expires_at | price_amount | billing_cycle |
        | domain  | qinghe.design | 2027-11-16 | 1200         | yearly        |
        | hosting | 基本方案        | 2027-11-16 | 6000         | yearly        |
      Then 操作成功
      And 網站 "青禾新官網" 應為：
        | client | status |
        | 青禾設計 | live   |
      And 專案 "青禾新官網" 應為：
        | site     | handover_completed_at     |
        | 青禾新官網 | 2026-11-16T10:00:00+08:00 |

  Rule: 後置（連鎖）- 專案已綁網站時沿用該網站，網站狀態改為「已上線」

    Example: 已綁建置中網站的專案轉維運後網站上線
      Given 系統中有以下專案：
        | name     | client | site   | category | status    | start_date | due_date   | handover_completed_at |
        | 青禾改版 | 青禾設計 | 青禾舊站 | new_site | completed | 2026-11-01 | 2026-12-31 |                       |
      When 管理者送出專案 "青禾改版" 的轉維運表單：
        | type   | identifier    | expires_at | price_amount | billing_cycle |
        | domain | qinghe.design | 2027-11-16 | 1200         | yearly        |
      Then 操作成功
      And 網站 "青禾舊站" 應為：
        | status |
        | live   |

  Rule: 後置（連鎖）- 依表單建立服務項目，並同步寫入「網站到期管理」日曆的到期事件

    Example: 轉維運建立的服務項目與表單一致
      Given 系統中有以下專案：
        | name     | client | site | category | status    | start_date | due_date   | handover_completed_at |
        | 青禾新官網 | 青禾設計 |      | new_site | completed | 2026-11-01 | 2026-12-31 |                       |
      When 管理者送出專案 "青禾新官網" 的轉維運表單：
        | type    | identifier    | expires_at | price_amount | billing_cycle |
        | domain  | qinghe.design | 2027-11-16 | 1200         | yearly        |
        | hosting | 基本方案        | 2027-11-16 | 6000         | yearly        |
      Then 網站 "青禾新官網" 應有以下服務項目：
        | type    | identifier    | expires_at | price_amount | billing_cycle | status | renewal_state | source_project |
        | domain  | qinghe.design | 2027-11-16 | 1200         | yearly        | active | upcoming      | 青禾新官網       |
        | hosting | 基本方案        | 2027-11-16 | 6000         | yearly        | active | upcoming      | 青禾新官網       |
      And 「網站到期管理」日曆應有 2 個到期事件
