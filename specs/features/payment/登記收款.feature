@command
Feature: 登記收款

  管理者在後台登記某張報價單已收到款項。

  Background:
    Given 今天是 "2026-11-16"
    And 系統中有以下客戶：
      | name   | status |
      | 小森咖啡 | active |
    And 系統中有以下網站：
      | name     | client | status |
      | 小森咖啡官網 | 小森咖啡 | live   |

  Rule: 前置（狀態）- 報價單必須為「已寄出」或「客戶已同意」狀態

    Scenario Outline: 報價單狀態不允許登記收款時操作失敗
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status   | sent_at | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261110   | 小森咖啡 | 小森咖啡官網 |         | <status> |         |             | 2026-12-20  | 2026-11-24  | 8400  |         |
      When 管理者登記收款：
        | quote_no | paid_on    | paid_amount |
        | 261110   | 2026-11-15 | 8400        |
      Then 操作失敗，violation_type 為 "INVALID_QUOTE_STATUS"

      Examples:
        | status           |
        | draft            |
        | pending_approval |
        | cancelled        |

  Rule: 前置（狀態）- 已登記收款的報價單不可重複登記

    Example: 已收款的報價單再次登記時操作失敗
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status   | sent_at                   | accepted_at               | anchor_date | valid_until | total | paid_on    |
        | 261110   | 小森咖啡 | 小森咖啡官網 |         | accepted | 2026-11-10T10:00:00+08:00 | 2026-11-12T10:00:00+08:00 | 2026-12-20  | 2026-11-24  | 8400  | 2026-11-14 |
      When 管理者登記收款：
        | quote_no | paid_on    | paid_amount |
        | 261110   | 2026-11-15 | 8400        |
      Then 操作失敗，violation_type 為 "ALREADY_PAID"

  Rule: 前置（參數）- 必填收款日期與實收金額；匯款證明附件為選填

    Scenario Outline: 缺少必填欄位時操作失敗
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status | sent_at                   | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261110   | 小森咖啡 | 小森咖啡官網 |         | sent   | 2026-11-10T10:00:00+08:00 |             | 2026-12-20  | 2026-11-24  | 8400  |         |
      When 管理者登記收款：
        | quote_no | paid_on   | paid_amount   |
        | 261110   | <paid_on> | <paid_amount> |
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

      Examples:
        | paid_on    | paid_amount |
        |            | 8400        |
        | 2026-11-15 |             |

  Rule: 前置（參數）- 實收金額必須大於 0；收款日期不可晚於今天

    Scenario Outline: 金額或日期超出範圍時操作失敗
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status | sent_at                   | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261110   | 小森咖啡 | 小森咖啡官網 |         | sent   | 2026-11-10T10:00:00+08:00 |             | 2026-12-20  | 2026-11-24  | 8400  |         |
      When 管理者登記收款：
        | quote_no | paid_on   | paid_amount   |
        | 261110   | <paid_on> | <paid_amount> |
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

      Examples:
        | paid_on    | paid_amount |
        | 2026-11-15 | 0           |
        | 2026-11-15 | -100        |
        | 2026-11-17 | 8400        |

  Rule: 後置（狀態）- 報價單標記為已收款；原為「已寄出」者一併改為「客戶已同意」

    Scenario Outline: 登記收款後報價單狀態與收款資料正確
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status   | sent_at                   | accepted_at   | anchor_date | valid_until | total | paid_on |
        | 261110   | 小森咖啡 | 小森咖啡官網 |         | <before> | 2026-11-10T10:00:00+08:00 | <accepted_at> | 2026-12-20  | 2026-11-24  | 8400  |         |
      When 管理者登記收款：
        | quote_no | paid_on    | paid_amount |
        | 261110   | 2026-11-16 | 8370        |
      Then 操作成功
      And 報價單 "261110" 應為：
        | status   | paid_on    | paid_amount |
        | accepted | 2026-11-16 | 8370        |

      Examples:
        | before   | accepted_at               |
        | sent     |                           |
        | accepted | 2026-11-12T10:00:00+08:00 |

    Example: 附上匯款證明時附件一併保存
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status | sent_at                   | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261110   | 小森咖啡 | 小森咖啡官網 |         | sent   | 2026-11-10T10:00:00+08:00 |             | 2026-12-20  | 2026-11-24  | 8400  |         |
      When 管理者登記收款：
        | quote_no | paid_on    | paid_amount | proof_file   |
        | 261110   | 2026-11-16 | 8400        | 匯款明細.png |
      Then 操作成功
      And 報價單 "261110" 應有以下附件：
        | kind          | filename     |
        | payment_proof | 匯款明細.png |

  Rule: 後置（狀態）- 收款不會自動推進服務項目到期日，續約仍由管理者在服務項目操作

    Example: 登記收款後服務項目到期日不變
      Given 系統中有以下服務項目：
        | site     | type   | identifier     | expires_at | price_amount | status |
        | 小森咖啡官網 | domain | morimori.com.tw | 2026-12-20 | 1200         | active |
      And 系統中有以下報價單：
        | quote_no | client | site     | project | status | sent_at                   | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261110   | 小森咖啡 | 小森咖啡官網 |         | sent   | 2026-11-10T10:00:00+08:00 |             | 2026-12-20  | 2026-11-24  | 1260  |         |
      And 報價單 "261110" 包含服務項目 "morimori.com.tw"
      When 管理者登記收款：
        | quote_no | paid_on    | paid_amount |
        | 261110   | 2026-11-16 | 1260        |
      Then 服務項目 "morimori.com.tw" 的到期日應為 "2026-12-20"
