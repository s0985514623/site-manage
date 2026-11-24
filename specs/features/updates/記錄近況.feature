@command
Feature: 記錄近況

  管理者在專案頁或網站頁，用對話方塊的方式依時間新增近況：每則可以有文字與多張圖片。
  圖片存在資料庫（隨資料庫備份），只收瀏覽器能直接顯示的 JPG、PNG、WebP。

  Background:
    Given 系統中有以下客戶：
      | name     |
      | 小森咖啡 |
    And 系統中有以下網站：
      | name         | client   |
      | 小森咖啡官網 | 小森咖啡 |
    And 系統中有以下專案：
      | name       | client   | category |
      | 官網改版   | 小森咖啡 | new_site |

  Rule: 前置（參數）- 文字與圖片至少要有一個

    Example: 沒有文字也沒有圖片時操作失敗
      When 管理者在專案 "官網改版" 新增近況，文字為 "   "，沒有圖片
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

  Rule: 前置（參數）- 圖片只收 JPG、PNG、WebP，一則最多 10 張、合計 10MB

    Example: 圖片格式不符時操作失敗
      When 管理者在專案 "官網改版" 新增近況，附上 "報價.pdf"
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

    Example: 超過 10 張圖片時操作失敗
      When 管理者在專案 "官網改版" 新增近況，附上 11 張圖片
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

  Rule: 前置（狀態）- 專案或網站必須存在

    Example: 專案不存在時操作失敗
      When 管理者在不存在的專案新增近況，文字為 "測試"
      Then 操作失敗，violation_type 為 "NOT_FOUND"

  Rule: 後置（狀態）- 近況掛在專案或網站底下，圖片依上傳順序保存

    Example: 在專案新增一則文字近況
      When 管理者在專案 "官網改版" 新增近況，文字為 "首頁設計稿已寄給客戶"
      Then 操作成功
      And 專案 "官網改版" 的近況應有 1 則，內容為 "首頁設計稿已寄給客戶"

    Example: 在網站新增帶圖片的近況
      When 管理者在網站 "小森咖啡官網" 新增近況，文字為 "外掛更新後版面跑掉"，附上 "a.png"、"b.jpg"
      Then 操作成功
      And 網站 "小森咖啡官網" 的近況應有 1 則，圖片依序為 "a.png"、"b.jpg"

  Rule: 後置（回應）- 近況依時間由舊到新排列（對話串，最新在最下面）

    Example: 近況依時間由舊到新排列
      Given 今天是 "2026-11-20"，管理者在專案 "官網改版" 新增近況 "需求訪談完成"
      And 今天是 "2026-11-24"，管理者在專案 "官網改版" 新增近況 "設計稿確認"
      When 查詢專案 "官網改版" 的近況
      Then 近況依序為 "需求訪談完成"、"設計稿確認"

  Rule: 後置（狀態）- 刪除近況或刪除專案時，圖片一併刪除

    Example: 刪除近況時一併刪除圖片
      Given 專案 "官網改版" 有一則附 1 張圖片的近況
      When 管理者刪除這則近況
      Then 操作成功
      And 系統中不應有任何近況圖片

    Example: 刪除專案時近況一併刪除
      Given 專案 "官網改版" 有一則附 1 張圖片的近況
      When 刪除專案 "官網改版"
      Then 系統中不應有任何近況與近況圖片
