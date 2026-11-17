@command
Feature: 設定報價單用印

  管理者在設定頁上傳乙方大章（公司章）與小章（負責人章），報價單 PDF 的乙方「用印」欄自動蓋上。
  圖檔存在資料庫，不進版控；可用開關暫停自動用印。

  Background:
    Given 今天是 "2026-11-17"

  Rule: 前置（參數）- 只接受 PNG 或 JPEG 圖檔，單檔上限 2MB

    Scenario Outline: 檔案格式或大小不符時操作失敗
      When 管理者上傳用印圖檔：
        | kind   | file   |
        | <kind> | <file> |
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

      Examples:
        | kind    | file              |
        | company | 大章.pdf           |
        | company | 超過 2MB 的大章.png |
        | other   | 大章.png           |

  Rule: 後置（狀態）- 上傳後取代同一種章的舊圖檔

    Example: 重新上傳大章時取代舊檔
      Given 已上傳大章 "舊大章.png"
      When 管理者上傳用印圖檔：
        | kind    | file     |
        | company | 新大章.png |
      Then 操作成功
      And 系統中的大章應為 "新大章.png" 的內容

  Rule: 後置（回應）- 自動用印開啟且已上傳時，報價單 PDF 的乙方用印欄帶入大小章；甲方用印欄維持空白

    Example: 已上傳大小章時 PDF 帶入用印
      Given 已上傳大章 "大章.png"
      And 已上傳小章 "小章.png"
      When 產生報價單 PDF
      Then PDF 的乙方用印應包含大章與小章

  Rule: 後置（回應）- 自動用印關閉或尚未上傳時，PDF 的用印欄維持空白（可手動蓋章）

    Example: 關閉自動用印時 PDF 不帶入用印
      Given 已上傳大章 "大章.png"
      And 自動用印為關閉
      When 產生報價單 PDF
      Then PDF 的乙方用印應為空白

    Example: 只上傳大章時 PDF 只帶入大章
      Given 已上傳大章 "大章.png"
      When 產生報價單 PDF
      Then PDF 的乙方用印應只包含大章

  Rule: 後置（狀態）- 可刪除已上傳的章

    Example: 刪除小章後 PDF 不再帶入小章
      Given 已上傳大章 "大章.png"
      And 已上傳小章 "小章.png"
      When 管理者刪除小章
      Then 操作成功
      And 產生報價單 PDF 時乙方用印應只包含大章
