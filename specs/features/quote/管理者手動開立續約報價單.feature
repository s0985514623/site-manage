@command
Feature: 管理者手動開立續約報價單

  在網站頁或到期總表按「開立續約報價單」，不必等排程的觸發天數。
  合併分組、期間計算沿用排程擬定草稿的規則（verify:quotes 守護），
  差別只在：不檢查觸發天數、產生後停在草稿（不推 LINE），由管理者在報價單頁寄出。

  Background:
    Given 今天是 "2026-11-16"
    And 系統設定為：
      | auto_send_enabled | quote_trigger_days | quote_window_days |
      | true              | 45                 | 60                |
    And 系統中有以下客戶：
      | name   | status |
      | 小森咖啡 | active |
    And 系統中有以下網站：
      | name     | client | status |
      | 小森咖啡官網 | 小森咖啡 | live   |

  Rule: 前置（狀態）- 網站必須存在

    Example: 網站不存在時操作失敗
      When 管理者為不存在的網站開立續約報價單
      Then 操作失敗，violation_type 為 "NOT_FOUND"

  Rule: 前置（狀態）- 網站要有尚未被報價單涵蓋、且有售價的我方代管項目

    Example: 沒有可續約項目時操作失敗
      Given 系統中有以下服務項目：
        | site     | type   | identifier     | expires_at | price_amount | is_ours |
        | 小森咖啡官網 | domain | morimori.com.tw | 2026-12-20 | 1200         | false   |
      When 管理者為網站 "小森咖啡官網" 開立續約報價單
      Then 操作失敗，violation_type 為 "NO_RENEWABLE_SERVICE"

    Example: 項目都沒設售價時操作失敗
      Given 系統中有以下服務項目：
        | site     | type   | identifier     | expires_at | price_amount | is_ours |
        | 小森咖啡官網 | domain | morimori.com.tw | 2026-12-20 |              | true    |
      When 管理者為網站 "小森咖啡官網" 開立續約報價單
      Then 操作失敗，violation_type 為 "NO_RENEWABLE_SERVICE"

    Example: 已被報價單涵蓋的項目不會重複開單
      Given 系統中有以下服務項目：
        | site     | type   | identifier     | expires_at | price_amount | is_ours |
        | 小森咖啡官網 | domain | morimori.com.tw | 2026-12-20 | 1200         | true    |
      And 管理者為網站 "小森咖啡官網" 開立續約報價單
      When 管理者為網站 "小森咖啡官網" 開立續約報價單
      Then 操作失敗，violation_type 為 "NO_RENEWABLE_SERVICE"
      And 小森咖啡官網 應有 1 張報價單

    Example: 同時按兩次只會開出一張
      Given 系統中有以下服務項目：
        | site     | type   | identifier     | expires_at | price_amount | is_ours |
        | 小森咖啡官網 | domain | morimori.com.tw | 2026-12-20 | 1200         | true    |
      When 管理者同時為網站 "小森咖啡官網" 開立續約報價單兩次
      Then 其中一次操作成功，另一次操作失敗，violation_type 為 "NO_RENEWABLE_SERVICE"
      And 小森咖啡官網 應有 1 張報價單

    Example: 混合幣別時操作失敗
      Given 系統中有以下服務項目：
        | site     | type    | identifier     | expires_at | price_amount | currency | is_ours |
        | 小森咖啡官網 | domain  | morimori.com.tw | 2026-12-20 | 1200         | TWD      | true    |
        | 小森咖啡官網 | hosting | 雲端主機         | 2026-12-31 | 100          | USD      | true    |
      When 管理者為網站 "小森咖啡官網" 開立續約報價單
      Then 操作失敗，violation_type 為 "MIXED_CURRENCY"

  Rule: 後置（狀態）- 不檢查觸發天數，錨點往後視窗天數內的項目合併成一張草稿

    Example: 尚未到觸發天數也能開立
      Given 系統中有以下服務項目：
        | site     | type   | identifier     | expires_at | price_amount | is_ours |
        | 小森咖啡官網 | domain | morimori.com.tw | 2027-03-01 | 1200         | true    |
      When 管理者為網站 "小森咖啡官網" 開立續約報價單
      Then 操作成功
      And 小森咖啡官網 應有 1 張報價單，狀態為 "draft"

    Example: 視窗內的項目合併、視窗外的不納入
      Given 系統中有以下服務項目：
        | site     | type    | identifier     | expires_at | price_amount | is_ours |
        | 小森咖啡官網 | domain  | morimori.com.tw | 2026-12-20 | 1200         | true    |
        | 小森咖啡官網 | hosting | 雲端主機         | 2027-01-31 | 6000         | true    |
        | 小森咖啡官網 | maintenance | 年度維護      | 2027-06-30 | 12000        | true    |
      When 管理者為網站 "小森咖啡官網" 開立續約報價單
      Then 操作成功
      And 報價單應包含服務項目：
        | identifier     |
        | morimori.com.tw |
        | 雲端主機         |
      And 服務項目 "年度維護" 續約狀態應為 "upcoming"

  Rule: 後置（狀態）- 草稿停在 draft、不推 LINE；涵蓋的項目續約狀態改為 drafted

    Example: 自動寄模式下手動開立也不推 LINE
      Given 系統中有以下服務項目：
        | site     | type   | identifier     | expires_at | price_amount | is_ours |
        | 小森咖啡官網 | domain | morimori.com.tw | 2026-12-20 | 1200         | true    |
      When 管理者為網站 "小森咖啡官網" 開立續約報價單
      Then 小森咖啡官網 應有 1 張報價單，狀態為 "draft"
      And 服務項目 "morimori.com.tw" 續約狀態應為 "drafted"
      And 不應推播任何 LINE 訊息
