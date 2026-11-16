@command
Feature: 管理者在LINE確認報價單

  （既有功能 /api/line/webhook postback 的變更）加入寄送模式檢查。
  既有四道關卡（簽章、管理者 userId、一次性 token 原子消耗、狀態為待確認）保持不變，由既有驗證守護。

  Background:
    Given 今天是 "2026-11-16"
    And 系統中有以下客戶：
      | name   | status |
      | 小森咖啡 | active |
    And 系統中有以下網站：
      | name     | client | status |
      | 小森咖啡官網 | 小森咖啡 | live   |
    And 系統中有以下報價收件人：
      | client | email            |
      | 小森咖啡 | boss@morimori.tw |
    And 系統中有以下報價單：
      | quote_no | client | site     | project | status           | sent_at | accepted_at | anchor_date | valid_until | total | paid_on |
      | 261110   | 小森咖啡 | 小森咖啡官網 |         | pending_approval |         |             | 2026-12-20  | 2026-11-24  | 8400  |         |
    And 報價單 "261110" 有一組未使用的 LINE 確認 token "tok-261110"

  Rule: 前置（狀態）- 寄送模式必須為「LINE確認後自動寄」，否則不寄信並回覆「目前為手動寄送模式，請至後台按寄出」

    Example: 手動寄模式下按 LINE 確認按鈕不寄信
      Given 系統設定為：
        | auto_send_enabled | line_admin_configured | mail_configured |
        | false             | true                  | true            |
      When 管理者在 LINE 按下報價確認按鈕：
        | act     | token      |
        | approve | tok-261110 |
      Then LINE 應回覆以下訊息：
        | contains                     |
        | 目前為手動寄送模式，請至後台按寄出 |
      And 不應寄出任何 Email
      And 報價單 "261110" 應為：
        | status           |
        | pending_approval |

  Rule: 後置（狀態）- 寄出成功後報價單狀態為「已寄出」，並記錄寄出時間作為未回覆追蹤的起算日

    Example: 自動寄模式下按確認後寄出報價單
      Given 系統設定為：
        | auto_send_enabled | line_admin_configured | mail_configured |
        | true              | true                  | true            |
      When 管理者在 LINE 按下報價確認按鈕：
        | act     | token      |
        | approve | tok-261110 |
      Then 應寄出以下 Email：
        | to               | subject_contains |
        | boss@morimori.tw | 261110           |
      And 報價單 "261110" 應為：
        | status | sent_at                   |
        | sent   | 2026-11-16T10:00:00+08:00 |
