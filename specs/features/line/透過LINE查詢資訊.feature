@query
Feature: 透過LINE查詢資訊

  管理者在 LINE 點選單按鈕查詢資料（經 /api/line/webhook）。

  Background:
    Given 今天是 "2026-11-16"
    And 系統設定為：
      | line_admin_configured |
      | true                  |
    And 系統中有以下客戶：
      | name   | status |
      | 小森咖啡 | active |
      | 青禾設計 | active |
    And 系統中有以下網站：
      | name     | client | status |
      | 小森咖啡官網 | 小森咖啡 | live   |

  Rule: 前置（狀態）- 只回應 LINE 管理者帳號（簽章驗證 + LINE_ADMIN_USER_ID），其他帳號回覆無權限

    Example: 非管理者查詢時回覆無權限
      When 非管理者 LINE 帳號在 LINE 傳送：
        | type     | value         |
        | postback | query=expiring |
      Then LINE 應回覆以下訊息：
        | contains       |
        | 這個帳號沒有操作權限 |

    Example: 簽章不正確的請求被拒絕
      When LINE webhook 收到簽章不正確的請求
      Then 回應的 HTTP 狀態碼應為 401

  Rule: 後置（回應）- 提供三種查詢：近期到期項目、待處理報價（待確認 / 未回覆 / 未收款）、進行中專案

    Example: 查詢近期到期項目
      Given 系統中有以下服務項目：
        | site     | type    | identifier     | expires_at | price_amount | status |
        | 小森咖啡官網 | domain  | morimori.com.tw | 2026-11-30 | 1200         | active |
        | 小森咖啡官網 | hosting | 基本方案         | 2027-06-30 | 6000         | active |
      When 管理者在 LINE 傳送：
        | type     | value          |
        | postback | query=expiring |
      Then LINE 應回覆以下訊息：
        | contains                      |
        | morimori.com.tw 2026-11-30（14 天） |
      And LINE 回覆不應包含 "基本方案"

    Example: 查詢待處理報價
      Given 系統中有以下報價單：
        | quote_no | client | site     | project | status           | sent_at                   | accepted_at               | anchor_date | valid_until | total | paid_on |
        | 261110   | 小森咖啡 | 小森咖啡官網 |         | pending_approval |                           |                           | 2026-12-20  | 2026-11-24  | 8400  |         |
        | 261109   | 小森咖啡 | 小森咖啡官網 |         | sent             | 2026-11-09T10:00:00+08:00 |                           | 2026-12-20  | 2026-11-23  | 8400  |         |
        | 261101   | 小森咖啡 | 小森咖啡官網 |         | accepted         | 2026-11-01T10:00:00+08:00 | 2026-11-03T10:00:00+08:00 | 2026-11-23  | 2026-11-15  | 8400  |         |
        | 261001   | 小森咖啡 | 小森咖啡官網 |         | accepted         | 2026-10-01T10:00:00+08:00 | 2026-10-03T10:00:00+08:00 | 2026-10-23  | 2026-10-15  | 8400  | 2026-10-10 |
      When 管理者在 LINE 傳送：
        | type     | value        |
        | postback | query=quotes |
      Then LINE 應回覆以下訊息：
        | contains                                     |
        | 待確認：261110；未回覆：261109；未收款：261101 |
      And LINE 回覆不應包含 "261001"

    Example: 查詢進行中專案
      Given 系統中有以下專案：
        | name       | client | site | category      | status      | start_date | due_date   | handover_completed_at |
        | 青禾新官網   | 青禾設計 |      | new_site      | in_progress | 2026-11-01 | 2026-12-31 |                       |
        | 結帳頁修正   | 小森咖啡 |      | bug_fix       | completed   | 2026-10-20 | 2026-10-25 |                       |
      When 管理者在 LINE 傳送：
        | type     | value          |
        | postback | query=projects |
      Then LINE 應回覆以下訊息：
        | contains              |
        | 青禾新官網（進行中，12/31 截止） |
      And LINE 回覆不應包含 "結帳頁修正"

  Rule: 後置（回應）- 每種查詢最多列 5 筆，超過時附後台連結

    Example: 進行中專案超過 5 筆時只列 5 筆並附連結
      Given 青禾設計 有 6 個進行中專案，截止日分別為 2026-12-01 至 2026-12-06
      When 管理者在 LINE 傳送：
        | type     | value          |
        | postback | query=projects |
      Then LINE 回覆應列出 5 筆專案
      And LINE 應回覆以下訊息：
        | contains         |
        | 還有 1 筆，查看全部 |

  Rule: 後置（回應）- 以 reply 回覆，不耗推播額度

    Example: 查詢回覆不增加推播計數
      Given LINE 本月已推播 10 則
      When 管理者在 LINE 傳送：
        | type     | value          |
        | postback | query=expiring |
      Then LINE 本月推播計數應為 10
