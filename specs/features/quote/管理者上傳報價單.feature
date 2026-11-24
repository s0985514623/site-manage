@command
Feature: 管理者上傳報價單

  管理者在專案頁或網站頁上傳自己做好的報價單 PDF，建成一張正式報價單（source = uploaded）。
  沒有明細，只記錄合計；檢視 PDF 與寄信附件都直接使用上傳的原檔。
  之後與系統產生的報價單共用寄送、追蹤未回覆、登記收款流程。

  Background:
    Given 今天是 "2026-11-24"
    And 系統中有以下客戶：
      | name     |
      | 小森咖啡 |
    And 系統中有以下網站：
      | name         | client   |
      | 小森咖啡官網 | 小森咖啡 |
    And 系統中有以下專案：
      | name     | client   | category | site         |
      | 官網改版 | 小森咖啡 | new_site | 小森咖啡官網 |
    And 系統設定 quote_valid_days 為 14

  Rule: 前置（參數）- 只接受 PDF，合計必須大於 0

    Example: 非 PDF 檔案時操作失敗
      When 管理者在專案 "官網改版" 上傳報價單 "報價.png"，合計 "30000"
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

    Scenario Outline: 合計金額不大於 0 時操作失敗
      When 管理者在專案 "官網改版" 上傳報價單 "報價.pdf"，合計 "<total>"
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

      Examples:
        | total |
        | 0     |
        | -100  |
        | abc   |

  Rule: 前置（參數）- 有效期限不可早於開立日期

    Example: 有效期限早於開立日期時操作失敗
      When 管理者在專案 "官網改版" 上傳報價單 "報價.pdf"，合計 "30000"，開立日 "2026-11-24"，有效期限 "2026-11-20"
      Then 操作失敗，violation_type 為 "INVALID_DATE_RANGE"

  Rule: 前置（狀態）- 自填的單號不可與既有報價單重複

    Example: 單號已被使用時操作失敗
      Given 已有報價單 "261124"
      When 管理者在專案 "官網改版" 上傳報價單 "報價.pdf"，合計 "30000"，單號 "261124"
      Then 操作失敗，violation_type 為 "QUOTE_NO_TAKEN"

  Rule: 後置（狀態）- 建立草稿報價單；客戶與網站跟著專案或網站帶入，單號留空時自動編號

    Example: 在專案上傳報價單 PDF 建立草稿
      When 管理者在專案 "官網改版" 上傳報價單 "報價.pdf"，合計 "30000"
      Then 操作成功
      And 報價單 "261124" 應為：
        | source   | status | client   | site         | project  | total    | valid_until |
        | uploaded | draft  | 小森咖啡 | 小森咖啡官網 | 官網改版 | 30000.00 | 2026-12-08  |

    Example: 在網站上傳報價單 PDF 建立草稿
      When 管理者在網站 "小森咖啡官網" 上傳報價單 "續約.pdf"，合計 "8400"，單號 "A-2026-01"
      Then 操作成功
      And 報價單 "A-2026-01" 應為：
        | source   | status | client   | site         | project | total   |
        | uploaded | draft  | 小森咖啡 | 小森咖啡官網 |         | 8400.00 |

  Rule: 後置（狀態）- 勾選「已自行寄出」時直接標記為已寄出，進入追蹤未回覆

    Example: 勾選已寄出時直接標記為已寄出
      When 管理者在專案 "官網改版" 上傳報價單 "報價.pdf"，合計 "30000"，並勾選已寄出
      Then 操作成功
      And 報價單 "261124" 的狀態應為 "sent"，且有寄出時間

  Rule: 後置（回應）- 檢視 PDF 與寄出時都使用上傳的原檔

    Example: 檢視 PDF 時回傳上傳的原檔
      Given 管理者在專案 "官網改版" 上傳了報價單 "報價.pdf"
      When 產生報價單 "261124" 的 PDF
      Then 內容應與上傳的 "報價.pdf" 完全相同

    Example: 寄出上傳的報價單時附上原檔
      Given 管理者在專案 "官網改版" 上傳了報價單 "報價.pdf"
      And 客戶 "小森咖啡" 的報價收件人為 "boss@morimori.tw"
      When 管理者寄出報價單 "261124"
      Then 操作成功
      And 寄給 "boss@morimori.tw" 的信應附上上傳的 "報價.pdf"
