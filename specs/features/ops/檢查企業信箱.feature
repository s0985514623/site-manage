@command
Feature: 檢查企業信箱

  網站有使用中的企業信箱服務時，檢查信箱的 DNS 紀錄與收信伺服器是否正常。
  只做外部探測、不需要信箱密碼、不會真的寄信：
    收信：MX 紀錄＋連 MX 主機 25 port 做 SMTP 對話，RCPT TO 確認信箱會被收下
    寄信：SPF／DKIM／DMARC 設定（決定寄出的信會不會被退信或當垃圾信）
  預設信箱為 service@<網域>，網域取「偵測目標」→「項目名稱」（若是網域）→ 網站網址，去掉 www.。
  每項結果為 正常（ok）／注意（warn）／異常（fail），整體取最差的一項。

  Background:
    Given 今天是 "2026-11-24"
    And 有客戶 "冠澄"，網站 "官網"（https://www.acme.com.tw）
    And 網域 acme.com.tw 的 DNS 與收信伺服器都正常

  Rule: 前置（參數）- 只有企業信箱、且找得到網域才能檢查

    Example: 不是企業信箱的項目不能檢查
      Given "官網" 有主機服務 "基本方案"
      When 管理者檢查 "基本方案" 的信箱
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

    Example: 找不到網域時檢查失敗
      Given 網站 "官網" 沒有填網址
      And "官網" 有企業信箱服務 "企業信箱"
      When 管理者檢查 "企業信箱" 的信箱
      Then 操作失敗，violation_type 為 "NO_MAIL_DOMAIN"

  Rule: 後置（狀態）- 預設檢查 service@網域，可改成自訂信箱

    Example: 預設檢查 service@網站網域
      Given "官網" 有企業信箱服務 "企業信箱"
      When 管理者檢查 "企業信箱" 的信箱
      Then 操作成功
      And 最新檢查結果的信箱為 "service@acme.com.tw"，狀態為 "ok"

    Example: 填了檢查信箱就改檢查該信箱
      Given "官網" 有企業信箱服務 "企業信箱"，檢查信箱 "info@acme.com.tw"
      When 管理者檢查 "企業信箱" 的信箱
      Then 收信伺服器收到 RCPT TO "info@acme.com.tw"

  Rule: 後置（狀態）- 各項 DNS 與收信結果

    Example: 沒有 SPF 判定異常
      Given 網域 acme.com.tw 沒有 SPF 紀錄
      And "官網" 有企業信箱服務 "企業信箱"
      When 管理者檢查 "企業信箱" 的信箱
      Then 最新檢查結果的狀態為 "fail"，其中 "spf" 為 "fail"

    Example: 收信伺服器拒收信箱判定異常
      Given 收信伺服器對 RCPT TO 回 "550 5.1.1 User unknown"
      And "官網" 有企業信箱服務 "企業信箱"
      When 管理者檢查 "企業信箱" 的信箱
      Then 最新檢查結果的狀態為 "fail"，其中 "smtp" 為 "fail"

    Example: 連不上 25 port 只標示注意
      Given 收信伺服器的 25 port 連線逾時
      And "官網" 有企業信箱服務 "企業信箱"
      When 管理者檢查 "企業信箱" 的信箱
      Then 最新檢查結果的狀態為 "warn"，其中 "smtp" 為 "warn"

    Example: 指定的 DKIM selector 查不到判定異常
      Given "官網" 有企業信箱服務 "企業信箱"，DKIM selector "custom"
      When 管理者檢查 "企業信箱" 的信箱
      Then 最新檢查結果的狀態為 "fail"，其中 "dkim" 為 "fail"

  Rule: 後置（通知）- 排程每天檢查，只在變成異常與恢復時告警

    Example: 信箱由正常變成異常時用 LINE 與 Email 告警
      Given "官網" 有企業信箱服務 "企業信箱"，上次檢查為 "ok"
      And 網域 acme.com.tw 沒有 MX 紀錄
      When 排程執行信箱檢查
      Then 管理者收到 LINE 訊息包含 "信箱異常"
      And 管理者收到主旨為 "[信箱檢查] 1 個信箱異常" 的 Email

    Example: 持續異常不重複告警
      Given "官網" 有企業信箱服務 "企業信箱"，上次檢查為 "fail"
      And 網域 acme.com.tw 沒有 MX 紀錄
      When 排程執行信箱檢查
      Then 不應推送任何 LINE 訊息

    Example: 從異常恢復時通知
      Given "官網" 有企業信箱服務 "企業信箱"，上次檢查為 "fail"
      When 排程執行信箱檢查
      Then 管理者收到 LINE 訊息包含 "已恢復"

    Example: 已結案網站與已終止的信箱不檢查
      Given "官網" 有企業信箱服務 "企業信箱"，狀態為已終止
      And 有網站 "舊站"（https://old.example.com）已結案，有企業信箱服務 "舊信箱"
      When 排程執行信箱檢查
      Then 排程結果的檢查數為 0
