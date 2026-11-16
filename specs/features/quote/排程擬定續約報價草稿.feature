@command
Feature: 排程擬定續約報價草稿

  （既有功能 /api/cron/quote-draft 的變更）依寄送模式決定草稿產生後的後續動作。
  合併分組、期間計算等既有規則由 verify:quotes 守護，本 Feature 只描述本次變更。

  Background:
    Given 今天是 "2026-11-16"
    And 系統中有以下客戶：
      | name   | status |
      | 小森咖啡 | active |
    And 系統中有以下網站：
      | name     | client | status |
      | 小森咖啡官網 | 小森咖啡 | live   |
    And 系統中有以下服務項目：
      | site     | type   | identifier     | expires_at | price_amount | status |
      | 小森咖啡官網 | domain | morimori.com.tw | 2026-12-20 | 1200         | active |

  Rule: 後置（狀態）- 寄送模式為「LINE確認後自動寄」時，草稿推 LINE 確認訊息並進入待確認（沿用既有行為）

    Example: 自動寄模式產生草稿後推 LINE 確認訊息
      Given 系統設定為：
        | auto_send_enabled | line_admin_configured |
        | true              | true                  |
      When 排程執行「quote-draft」
      Then 小森咖啡官網 應有 1 張報價單，狀態為 "pending_approval"
      And LINE 應推播給管理者以下訊息：
        | kind     | contains |
        | 報價確認 | 確認寄出  |

  Rule: 後置（狀態）- 寄送模式為「手動寄」時，草稿維持草稿狀態，推一則 LINE 純通知（無寄出按鈕，附後台連結）

    Example: 手動寄模式產生草稿後只推純通知
      Given 系統設定為：
        | auto_send_enabled | line_admin_configured |
        | false             | true                  |
      When 排程執行「quote-draft」
      Then 小森咖啡官網 應有 1 張報價單，狀態為 "draft"
      And LINE 應推播給管理者以下訊息：
        | kind     | contains     |
        | 草稿通知 | 請至後台寄出 |

  Rule: 後置（狀態）- LINE 推播額度不足時，純通知改寄 Email（沿用既有 line-quota 降級）

    Example: 推播額度用完時純通知改寄 Email
      Given 系統設定為：
        | auto_send_enabled | line_admin_configured |
        | false             | true                  |
      And LINE 本月推播額度已用完
      When 排程執行「quote-draft」
      Then 不應推播任何 LINE 訊息
      And 應寄出以下 Email：
        | to     | subject_contains |
        | 管理者 | 報價草稿         |

  Rule: 後置（連鎖）- 執行成功後 ping 外部監控主機的心跳端點；ping 失敗不影響本次排程結果

    Example: 排程成功後送出心跳
      Given 系統設定為：
        | auto_send_enabled | line_admin_configured |
        | false             | true                  |
      When 排程執行「quote-draft」
      Then 心跳端點應收到以下 ping：
        | job         |
        | quote-draft |

    Example: 心跳端點無法連線時排程仍視為成功
      Given 系統設定為：
        | auto_send_enabled | line_admin_configured |
        | false             | true                  |
      And 心跳端點無法連線
      When 排程執行「quote-draft」
      Then 排程執行結果為成功
      And 小森咖啡官網 應有 1 張報價單，狀態為 "draft"
