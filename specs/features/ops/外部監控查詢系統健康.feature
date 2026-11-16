@query
Feature: 外部監控查詢系統健康

  外部監控主機（用戶另一台 PHP 主機）每 15 分鐘呼叫 GET /healthz 確認 VPS 存活。
  排程心跳的逾時判斷與告警發送在 PHP 主機端執行，不在本 repo（見 execution-plan 獨立交付物）。

  Rule: 前置（狀態）- 不需登入即可呼叫，回應只包含整體狀態，不洩漏內部細節

    Example: 未登入呼叫健康檢查可取得結果且不含細節
      When 外部監控主機以未登入狀態查詢系統健康
      Then 回應的 HTTP 狀態碼應為 200
      And 回應內容應只有以下欄位：
        | field  |
        | status |

  Rule: 後置（回應）- 應用程式與資料庫皆正常時回應 HTTP 200

    Example: 系統正常時回應 ok
      When 外部監控主機以未登入狀態查詢系統健康
      Then 回應的 HTTP 狀態碼應為 200
      And 回應內容應為：
        | status |
        | ok     |

  Rule: 後置（回應）- 資料庫無法連線時回應 HTTP 503

    Example: 資料庫斷線時回應 503
      Given 資料庫無法連線
      When 外部監控主機以未登入狀態查詢系統健康
      Then 回應的 HTTP 狀態碼應為 503
      And 回應內容應為：
        | status |
        | error  |
