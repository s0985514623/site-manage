@command
Feature: 管理者手動寄出報價單

  自動寄信開關關閉時，管理者在後台按「寄出」，由系統透過 Resend 寄出報價單 Email（附 PDF）。

  Background:
    Given 今天是 "2026-11-16"
    And 系統設定為：
      | auto_send_enabled | line_admin_configured | mail_configured |
      | false             | true                  | true            |
    And 系統中有以下客戶：
      | name   | status |
      | 小森咖啡 | active |
      | 青禾設計 | active |
    And 系統中有以下網站：
      | name     | client | status |
      | 小森咖啡官網 | 小森咖啡 | live   |
    And 系統中有以下專案：
      | name       | client | site | category      | status      | start_date | due_date   | handover_completed_at |
      | 會員集點外掛 | 青禾設計 |      | custom_plugin | in_progress | 2026-11-01 | 2026-12-31 |                       |
    And 系統中有以下報價收件人：
      | client | email               |
      | 小森咖啡 | boss@morimori.tw    |
      | 青禾設計 | pm@qinghe.design    |

  Rule: 前置（狀態）- 報價單必須為草稿或待確認狀態

    Scenario Outline: 報價單狀態不允許寄出時操作失敗
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status   | sent_at | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261110   | 小森咖啡 | 小森咖啡官網 |         | <status> |         |             | 2026-12-20  | 2026-11-24  | 8400  |         |
      When 管理者寄出報價單 "261110"
      Then 操作失敗，violation_type 為 "INVALID_QUOTE_STATUS"

      Examples:
        | status    |
        | accepted  |
        | cancelled |

  Rule: 前置（狀態）- 已寄出的報價單不可重複寄出（連點兩次只寄一封）

    Example: 連續按兩次寄出只寄出一封
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status | sent_at | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261110   | 小森咖啡 | 小森咖啡官網 |         | draft  |         |             | 2026-12-20  | 2026-11-24  | 8400  |         |
      When 管理者同時寄出報價單 "261110" 兩次
      Then 其中一次操作成功，另一次操作失敗，violation_type 為 "QUOTE_ALREADY_SENT"
      And 應寄出以下 Email：
        | to               | subject_contains |
        | boss@morimori.tw | 261110           |

  Rule: 前置（狀態）- 客戶必須有收件人 Email

    Example: 客戶沒有報價收件人時操作失敗
      Given 系統中有以下客戶：
        | name   | status |
        | 無窗口公司 | active |
      And 系統中有以下網站：
        | name     | client  | status |
        | 無窗口官網 | 無窗口公司 | live   |
      And 系統中有以下報價單：
        | quote_no | client  | site    | project | status | sent_at | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261111   | 無窗口公司 | 無窗口官網 |         | draft  |         |             | 2026-12-20  | 2026-11-24  | 3000  |         |
      When 管理者寄出報價單 "261111"
      Then 操作失敗，violation_type 為 "NO_RECIPIENT"
      And 不應寄出任何 Email

  Rule: 前置（狀態）- 寄信服務（Resend）必須已設定

    Example: 寄信服務未設定時操作失敗
      Given 系統設定為：
        | auto_send_enabled | line_admin_configured | mail_configured |
        | false             | true                  | false           |
      And 系統中有以下報價單：
        | quote_no | client | site     | project | status | sent_at | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261110   | 小森咖啡 | 小森咖啡官網 |         | draft  |         |             | 2026-12-20  | 2026-11-24  | 8400  |         |
      When 管理者寄出報價單 "261110"
      Then 操作失敗，violation_type 為 "MAIL_NOT_CONFIGURED"

  Rule: 後置（狀態）- 寄出成功後報價單狀態為「已寄出」，自動記錄寄出時間與實際收件人

    Scenario Outline: 草稿或待確認的報價單寄出成功
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status   | sent_at | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261110   | 小森咖啡 | 小森咖啡官網 |         | <status> |         |             | 2026-12-20  | 2026-11-24  | 8400  |         |
      When 管理者寄出報價單 "261110"
      Then 操作成功
      And 報價單 "261110" 應為：
        | status | sent_at                   | sent_to          |
        | sent   | 2026-11-16T10:00:00+08:00 | boss@morimori.tw |

      Examples:
        | status           |
        | draft            |
        | pending_approval |

  Rule: 後置（狀態）- 寄出成功後報價單內服務項目的續約狀態變為「已寄出」

    Example: 寄出後服務項目續約狀態同步為已寄出
      Given 系統中有以下服務項目：
        | site     | type   | identifier     | expires_at | price_amount | status |
        | 小森咖啡官網 | domain | morimori.com.tw | 2026-12-20 | 1200         | active |
      And 系統中有以下報價單：
        | quote_no | client | site     | project | status | sent_at | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261110   | 小森咖啡 | 小森咖啡官網 |         | draft  |         |             | 2026-12-20  | 2026-11-24  | 1260  |         |
      And 報價單 "261110" 包含服務項目 "morimori.com.tw"
      When 管理者寄出報價單 "261110"
      Then 服務項目 "morimori.com.tw" 的續約狀態應為 "sent"

  Rule: 後置（狀態）- 寄出失敗時報價單維持原狀態並顯示失敗原因

    Example: 寄信服務回報失敗時報價單維持草稿
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status | sent_at | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261110   | 小森咖啡 | 小森咖啡官網 |         | draft  |         |             | 2026-12-20  | 2026-11-24  | 8400  |         |
      And Email 寄送服務會失敗
      When 管理者寄出報價單 "261110"
      Then 操作失敗，violation_type 為 "MAIL_SEND_FAILED"
      And 報價單 "261110" 應為：
        | status | sent_at |
        | draft  |         |

  Rule: 後置（狀態）- 報價單未綁網站時，信件主旨與內文以專案名稱取代網站名稱

    Example: 專案報價單寄出時主旨使用專案名稱
      Given 系統中有以下報價單：
        | quote_no | client | site | project    | status | sent_at | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261112   | 青禾設計 |      | 會員集點外掛 | draft  |         |             |             | 2026-11-30  | 52500 |         |
      When 管理者寄出報價單 "261112"
      Then 操作成功
      And 應寄出以下 Email：
        | to               | subject_contains     |
        | pm@qinghe.design | 青禾設計 會員集點外掛 報價單 |
