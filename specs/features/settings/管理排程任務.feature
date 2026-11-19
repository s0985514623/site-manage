@command
Feature: 管理排程任務

  管理者在設定頁查看所有排程任務，可調整執行時間、停用，或新增 LINE 提醒、呼叫網址、替內建任務多加一個時段。
  VPS 只剩一支每分鐘的 timer 呼叫 /api/cron/tick，由 tick 依排程表執行到期的任務。
  時間一律為台北時間。

  Background:
    Given 今天是 "2026-11-16"，現在是 "10:00"

  Rule: 前置（參數）- 依任務類型與頻率檢查必填欄位

    Scenario Outline: 欄位不完整時新增失敗
      When 管理者新增排程任務：
        | kind   | frequency   | detail   |
        | <kind> | <frequency> | <detail> |
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

      Examples:
        | kind         | frequency | detail                 |
        | line_message | daily     | 提醒內容空白             |
        | http_request | daily     | 網址為 ftp://hook.test  |
        | line_message | daily     | 時間為 25:00            |
        | builtin      | daily     | 系統任務為 unknown       |

  Rule: 後置（狀態）- 存檔後立即排定下次執行時間

    Example: 新增每天的 LINE 提醒後排定下次執行時間
      When 管理者新增排程任務 "提醒對帳"：LINE 提醒、每天 09:00
      Then 操作成功
      And "提醒對帳" 的下次執行時間應為 "2026-11-17 09:00"

    Example: 每月 31 號的任務在小月改於月底執行
      Given 今天是 "2027-02-01"，現在是 "10:00"
      When 管理者新增排程任務 "月底結帳"：LINE 提醒、每月 31 號 18:00
      Then "月底結帳" 的下次執行時間應為 "2027-02-28 18:00"

    Example: 調整系統任務的時間只改時間不改任務內容
      Given 有系統任務 "到期掃描與提醒"：expiry-scan、每天 09:00
      When 管理者把 "到期掃描與提醒" 改為每天 15:00，任務類型送出 line_message
      Then 操作成功
      And "到期掃描與提醒" 的下次執行時間應為 "2026-11-16 15:00"
      And "到期掃描與提醒" 仍為系統任務 expiry-scan

  Rule: 前置（狀態）- 系統內建任務不可刪除，只能停用

    Example: 刪除系統任務失敗
      Given 有系統任務 "到期掃描與提醒"：expiry-scan、每天 09:00
      When 管理者刪除 "到期掃描與提醒"
      Then 操作失敗，violation_type 為 "SYSTEM_TASK_NOT_DELETABLE"

    Example: 刪除自訂任務成功
      Given 有排程任務 "提醒對帳"：LINE 提醒、每天 09:00
      When 管理者刪除 "提醒對帳"
      Then 操作成功
      And 排程表中不應有 "提醒對帳"

  Rule: 後置（狀態）- tick 只執行已到期且啟用的任務，執行前先排定下一次

    Example: 到期的 LINE 提醒推送給管理者並排定下一次
      Given 有排程任務 "提醒對帳"：LINE 提醒「記得對帳」、每天 09:00，下次執行 "2026-11-16 09:00"
      When 排程器執行 tick
      Then 管理者應收到 LINE「記得對帳」
      And "提醒對帳" 的上次執行結果應為成功
      And "提醒對帳" 的下次執行時間應為 "2026-11-17 09:00"

    Example: 未到期與已停用的任務不執行
      Given 有排程任務 "下午提醒"：LINE 提醒「下午」、每天 15:00，下次執行 "2026-11-16 15:00"
      And 有已停用的排程任務 "舊提醒"：LINE 提醒「舊」、每天 09:00，下次執行 "2026-11-16 09:00"
      When 排程器執行 tick
      Then 管理者不應收到任何 LINE

    Example: 停機錯過多次只補跑一次
      Given 有排程任務 "存活檢查"：呼叫網址 GET https://hook.test/ping、每 15 分鐘，下次執行 "2026-11-16 08:00"
      When 排程器執行 tick
      Then "https://hook.test/ping" 應被呼叫 1 次
      And "存活檢查" 的下次執行時間應為 "2026-11-16 10:15"

    Example: 尚未排定的任務第一次 tick 只排定不執行
      Given 有尚未排定的系統任務 "LINE 每週週報"：weekly-report、每週一 09:00
      When 排程器執行 tick
      Then 管理者不應收到任何 LINE
      And "LINE 每週週報" 的下次執行時間應為 "2026-11-23 09:00"

    Example: 同一時間兩次 tick 只執行一次
      Given 有排程任務 "提醒對帳"：LINE 提醒「記得對帳」、每天 09:00，下次執行 "2026-11-16 09:00"
      When 排程器同時執行兩次 tick
      Then 管理者應收到 1 則 LINE

  Rule: 後置（回應）- 執行結果記在任務上；內建任務沿用原本的路由並送出心跳

    Example: 呼叫網址失敗時記錄失敗原因
      Given 有排程任務 "觸發 wp-cron"：呼叫網址 POST https://hook.test/wp-cron.php、每天 09:00，下次執行 "2026-11-16 09:00"
      And 外部網址回應 500
      When 排程器執行 tick
      Then "觸發 wp-cron" 的上次執行結果應為失敗，訊息包含 "HTTP 500"

    Example: 內建任務由 tick 執行並送出心跳
      Given 有系統任務 "網站存活監控"：uptime、每 15 分鐘，下次執行 "2026-11-16 10:00"
      When 排程器執行 tick
      Then "網站存活監控" 的上次執行結果應為成功
      And 外部監控應收到 "uptime" 的心跳

    Example: LINE 額度用完時提醒改寄 Email
      Given LINE 本月推播額度已用完
      And 有排程任務 "提醒對帳"：LINE 提醒「記得對帳」、每天 09:00，下次執行 "2026-11-16 09:00"
      When 排程器執行 tick
      Then 管理者應收到主旨包含 "提醒對帳" 的 Email
