@command
Feature: 排程追蹤未回覆報價

  報價單寄出後仍未回覆時，推 LINE 提醒管理者追蹤。

  Background:
    Given 今天是 "2026-11-16"
    And 系統設定為：
      | auto_send_enabled | quote_followup_days | line_admin_configured |
      | false             | 7                   | true                  |
    And 系統中有以下客戶：
      | name   | status |
      | 小森咖啡 | active |
      | 青禾設計 | active |
    And 系統中有以下網站：
      | name     | client | status |
      | 小森咖啡官網 | 小森咖啡 | live   |
      | 青禾官網   | 青禾設計 | live   |

  Rule: 前置（狀態）- 只追蹤狀態為「已寄出」的報價單

    Scenario Outline: 非已寄出狀態的報價單不提醒
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status   | sent_at                   | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261101   | 小森咖啡 | 小森咖啡官網 |         | <status> | 2026-11-01T10:00:00+08:00 |             | 2026-12-20  | 2026-11-15  | 8400  |         |
      When 排程執行「quote-followup」
      Then 不應推播任何 LINE 訊息

      Examples:
        | status    |
        | accepted  |
        | rejected  |
        | cancelled |

  Rule: 後置（狀態）- 寄出滿 N 天仍為「已寄出」時推 LINE 提醒，之後每 N 天重複，直到狀態改變；N 預設 7，可在設定頁調整

    Scenario Outline: 寄出天數為 N 的倍數時提醒
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status | sent_at   | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261101   | 小森咖啡 | 小森咖啡官網 |         | sent   | <sent_at> |             | 2026-12-20  | 2026-12-31  | 8400  |         |
      When 排程執行「quote-followup」
      Then LINE 應推播給管理者以下訊息：
        | kind     | contains |
        | 報價追蹤 | 261101   |

      Examples:
        | sent_at                   |
        | 2026-11-09T10:00:00+08:00 |
        | 2026-11-02T10:00:00+08:00 |

    Scenario Outline: 寄出天數不是 N 的倍數時不提醒
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status | sent_at   | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261101   | 小森咖啡 | 小森咖啡官網 |         | sent   | <sent_at> |             | 2026-12-20  | 2026-12-31  | 8400  |         |
      When 排程執行「quote-followup」
      Then 不應推播任何 LINE 訊息

      Examples:
        | sent_at                   |
        | 2026-11-10T10:00:00+08:00 |
        | 2026-11-03T10:00:00+08:00 |

    Example: 追蹤天數調整為 3 天時第 3 天提醒
      Given 系統設定為：
        | auto_send_enabled | quote_followup_days | line_admin_configured |
        | false             | 3                   | true                  |
      And 系統中有以下報價單：
        | quote_no | client | site     | project | status | sent_at                   | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261113   | 小森咖啡 | 小森咖啡官網 |         | sent   | 2026-11-13T10:00:00+08:00 |             | 2026-12-20  | 2026-11-27  | 8400  |         |
      When 排程執行「quote-followup」
      Then LINE 應推播給管理者以下訊息：
        | kind     | contains |
        | 報價追蹤 | 261113   |

  Rule: 後置（狀態）- 同一張報價單同一天不重複提醒

    Example: 今天已提醒過的報價單不再提醒
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status | sent_at                   | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261109   | 小森咖啡 | 小森咖啡官網 |         | sent   | 2026-11-09T10:00:00+08:00 |             | 2026-12-20  | 2026-11-23  | 8400  |         |
      And 系統中有以下通知紀錄：
        | kind           | quote  | channel | sent_on    |
        | quote_followup | 261109 | line    | 2026-11-16 |
      When 排程執行「quote-followup」
      Then 不應推播任何 LINE 訊息

  Rule: 後置（狀態）- 多張報價單需提醒時彙總成一則 LINE

    Example: 兩張需追蹤的報價單合併成一則訊息
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status | sent_at                   | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261109   | 小森咖啡 | 小森咖啡官網 |         | sent   | 2026-11-09T10:00:00+08:00 |             | 2026-12-20  | 2026-11-23  | 8400  |         |
        | 261102   | 青禾設計 | 青禾官網   |         | sent   | 2026-11-02T10:00:00+08:00 |             | 2026-12-10  | 2026-11-16  | 3600  |         |
      When 排程執行「quote-followup」
      Then LINE 應推播給管理者以下訊息：
        | kind     | contains        |
        | 報價追蹤 | 261109、261102 |
      And LINE 推播給管理者的訊息數應為 1

  Rule: 後置（狀態）- 超過有效期限的報價單不自動改狀態，提醒中標示「已過有效期」

    Example: 已過有效期的報價單仍為已寄出並標示
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status | sent_at                   | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261102   | 小森咖啡 | 小森咖啡官網 |         | sent   | 2026-11-02T10:00:00+08:00 |             | 2026-12-10  | 2026-11-15  | 8400  |         |
      When 排程執行「quote-followup」
      Then LINE 應推播給管理者以下訊息：
        | kind     | contains         |
        | 報價追蹤 | 261102（已過有效期） |
      And 報價單 "261102" 應為：
        | status |
        | sent   |

  Rule: 後置（狀態）- LINE 推播額度不足時改寄 Email

    Example: 推播額度用完時追蹤提醒改寄 Email
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status | sent_at                   | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261109   | 小森咖啡 | 小森咖啡官網 |         | sent   | 2026-11-09T10:00:00+08:00 |             | 2026-12-20  | 2026-11-23  | 8400  |         |
      And LINE 本月推播額度已用完
      When 排程執行「quote-followup」
      Then 不應推播任何 LINE 訊息
      And 應寄出以下 Email：
        | to     | subject_contains |
        | 管理者 | 報價追蹤         |

  Rule: 後置（連鎖）- 執行成功後 ping 外部監控主機的心跳端點；ping 失敗不影響本次排程結果

    Example: 排程成功後送出心跳
      When 排程執行「quote-followup」
      Then 心跳端點應收到以下 ping：
        | job            |
        | quote-followup |
