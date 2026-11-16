@command
Feature: 切換報價寄送模式

  管理者在設定頁切換「自動寄信」開關：關閉 = 手動寄（後台按寄出），開啟 = LINE 確認後自動寄。

  Background:
    Given 今天是 "2026-11-16"

  Rule: 前置（參數）- 寄送模式必須為「手動寄」或「LINE確認後自動寄」其中之一

    Scenario Outline: 寄送模式不合法時操作失敗
      Given 系統設定為：
        | auto_send_enabled | line_admin_configured |
        | false             | true                  |
      When 管理者切換報價寄送模式：
        | mode   |
        | <mode> |
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

      Examples:
        | mode       |
        |            |
        | 自動寄給客戶 |

  Rule: 前置（狀態）- 切換為「LINE確認後自動寄」時，LINE 管理者帳號必須已設定

    Example: 未設定 LINE 管理者時切換為自動寄被拒
      Given 系統設定為：
        | auto_send_enabled | line_admin_configured |
        | false             | false                 |
      When 管理者切換報價寄送模式：
        | mode           |
        | LINE確認後自動寄 |
      Then 操作失敗，violation_type 為 "LINE_ADMIN_NOT_CONFIGURED"
      And 系統設定應為：
        | auto_send_enabled |
        | false             |

  Rule: 後置（狀態）- 系統預設寄送模式為「手動寄」

    Example: 全新系統的寄送模式為手動寄
      Given 系統尚未儲存任何設定
      When 管理者查詢系統設定
      Then 系統設定應為：
        | auto_send_enabled |
        | false             |

  Rule: 後置（狀態）- 切換後的模式套用於之後所有報價單的寄送流程

    Scenario Outline: 切換寄送模式後設定被更新
      Given 系統設定為：
        | auto_send_enabled | line_admin_configured |
        | <before>          | true                  |
      When 管理者切換報價寄送模式：
        | mode   |
        | <mode> |
      Then 操作成功
      And 系統設定應為：
        | auto_send_enabled |
        | <after>           |

      Examples:
        | before | mode           | after |
        | false  | LINE確認後自動寄 | true  |
        | true   | 手動寄           | false |

  Rule: 後置（狀態）- 切換為「手動寄」時，已推出的 LINE 確認按鈕不再能寄信，報價單維持待確認並可在後台按寄出

    Example: 切換為手動寄後待確認報價單狀態不變
      Given 系統設定為：
        | auto_send_enabled | line_admin_configured |
        | true              | true                  |
      And 系統中有以下客戶：
        | name   | status |
        | 小森咖啡 | active |
      And 系統中有以下報價單：
        | quote_no | client | site     | project | status           | sent_at | accepted_at | anchor_date | valid_until | total | paid_on |
        | 261110   | 小森咖啡 | 小森咖啡官網 |         | pending_approval |         |             | 2026-12-20  | 2026-11-24  | 8400  |         |
      When 管理者切換報價寄送模式：
        | mode |
        | 手動寄 |
      Then 操作成功
      And 報價單 "261110" 應為：
        | status           |
        | pending_approval |
