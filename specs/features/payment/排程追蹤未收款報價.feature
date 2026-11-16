@command
Feature: 排程追蹤未收款報價

  客戶已同意但尚未收款的報價單，到期時推 LINE 提醒管理者。

  Background:
    Given 今天是 "2026-11-16"
    And 系統設定為：
      | auto_send_enabled | line_admin_configured |
      | false             | true                  |
    And 系統中有以下客戶：
      | name   | status |
      | 小森咖啡 | active |
      | 青禾設計 | active |
    And 系統中有以下網站：
      | name     | client | status |
      | 小森咖啡官網 | 小森咖啡 | live   |
    And 系統中有以下專案：
      | name       | client | site | category      | status    | start_date | due_date   | handover_completed_at |
      | 會員集點外掛 | 青禾設計 |      | custom_plugin | completed | 2026-10-01 | 2026-10-31 |                       |

  Rule: 前置（狀態）- 只追蹤「客戶已同意」且尚未登記收款的報價單

    Scenario Outline: 非追蹤對象不提醒
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status   | sent_at                   | accepted_at               | anchor_date | valid_until | total | paid_on   |
        | 261101   | 小森咖啡 | 小森咖啡官網 |         | <status> | 2026-11-01T10:00:00+08:00 | 2026-11-03T10:00:00+08:00 | 2026-11-23  | 2026-11-15  | 8400  | <paid_on> |
      When 排程執行「payment-followup」
      Then 不應推播任何 LINE 訊息

      Examples:
        | status   | paid_on    |
        | sent     |            |
        | accepted | 2026-11-10 |

  Rule: 後置（狀態）- 續約報價自錨點到期日前 7 天起提醒；專案報價自客戶同意後 14 天起提醒；之後每 3 天重複

    Scenario Outline: 續約報價到達提醒日時提醒
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status   | sent_at                   | accepted_at               | anchor_date   | valid_until | total | paid_on |
        | 261101   | 小森咖啡 | 小森咖啡官網 |         | accepted | 2026-11-01T10:00:00+08:00 | 2026-11-03T10:00:00+08:00 | <anchor_date> | 2026-11-15  | 8400  |         |
      When 排程執行「payment-followup」
      Then LINE 應推播給管理者以下訊息：
        | kind     | contains |
        | 收款追蹤 | 261101   |

      Examples:
        | anchor_date |
        | 2026-11-23  |
        | 2026-11-20  |

    Scenario Outline: 續約報價未到提醒日時不提醒
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status   | sent_at                   | accepted_at               | anchor_date   | valid_until | total | paid_on |
        | 261101   | 小森咖啡 | 小森咖啡官網 |         | accepted | 2026-11-01T10:00:00+08:00 | 2026-11-03T10:00:00+08:00 | <anchor_date> | 2026-11-15  | 8400  |         |
      When 排程執行「payment-followup」
      Then 不應推播任何 LINE 訊息

      Examples:
        | anchor_date |
        | 2026-11-24  |
        | 2026-11-21  |

    Scenario Outline: 專案報價到達提醒日時提醒
      Given 系統中有以下報價單：
        | quote_no | client | site | project    | status   | sent_at                   | accepted_at   | anchor_date | valid_until | total | paid_on |
        | 261020   | 青禾設計 |      | 會員集點外掛 | accepted | 2026-10-20T10:00:00+08:00 | <accepted_at> |             | 2026-11-03  | 52500 |         |
      When 排程執行「payment-followup」
      Then LINE 應推播給管理者以下訊息：
        | kind     | contains |
        | 收款追蹤 | 261020   |

      Examples:
        | accepted_at               |
        | 2026-11-02T10:00:00+08:00 |
        | 2026-10-30T10:00:00+08:00 |

    Scenario Outline: 專案報價未到提醒日時不提醒
      Given 系統中有以下報價單：
        | quote_no | client | site | project    | status   | sent_at                   | accepted_at   | anchor_date | valid_until | total | paid_on |
        | 261020   | 青禾設計 |      | 會員集點外掛 | accepted | 2026-10-20T10:00:00+08:00 | <accepted_at> |             | 2026-11-03  | 52500 |         |
      When 排程執行「payment-followup」
      Then 不應推播任何 LINE 訊息

      Examples:
        | accepted_at               |
        | 2026-11-03T10:00:00+08:00 |
        | 2026-10-31T10:00:00+08:00 |

  Rule: 後置（狀態）- 同一張報價單同一天不重複提醒，多張彙總成一則 LINE

    Example: 今天已提醒過的報價單不再提醒
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status   | sent_at                   | accepted_at               | anchor_date | valid_until | total | paid_on |
        | 261101   | 小森咖啡 | 小森咖啡官網 |         | accepted | 2026-11-01T10:00:00+08:00 | 2026-11-03T10:00:00+08:00 | 2026-11-23  | 2026-11-15  | 8400  |         |
      And 系統中有以下通知紀錄：
        | kind             | quote  | channel | sent_on    |
        | payment_followup | 261101 | line    | 2026-11-16 |
      When 排程執行「payment-followup」
      Then 不應推播任何 LINE 訊息

    Example: 兩張需追蹤的報價單合併成一則訊息
      Given 系統中有以下報價單：
        | quote_no | client | site     | project    | status   | sent_at                   | accepted_at               | anchor_date | valid_until | total | paid_on |
        | 261101   | 小森咖啡 | 小森咖啡官網 |            | accepted | 2026-11-01T10:00:00+08:00 | 2026-11-03T10:00:00+08:00 | 2026-11-23  | 2026-11-15  | 8400  |         |
        | 261020   | 青禾設計 |          | 會員集點外掛 | accepted | 2026-10-20T10:00:00+08:00 | 2026-11-02T10:00:00+08:00 |             | 2026-11-03  | 52500 |         |
      When 排程執行「payment-followup」
      Then LINE 應推播給管理者以下訊息：
        | kind     | contains        |
        | 收款追蹤 | 261101、261020 |
      And LINE 推播給管理者的訊息數應為 1

  Rule: 後置（連鎖）- 執行成功後 ping 外部監控主機的心跳端點；ping 失敗不影響本次排程結果

    Example: 排程成功後送出心跳
      When 排程執行「payment-followup」
      Then 心跳端點應收到以下 ping：
        | job              |
        | payment-followup |
