@command
Feature: 透過LINE快速新增專案

  LINE 第一版只能快速新增專案，以按鈕逐步問答：選客戶 → 選類別 → 輸入名稱 → 選日期。

  Background:
    Given 今天是 "2026-11-16"
    And 系統設定為：
      | line_admin_configured |
      | true                  |
    And 系統中有以下客戶：
      | name   | status   |
      | 青禾設計 | active   |
      | 小森咖啡 | active   |
      | 停用客戶 | inactive |

  Rule: 前置（狀態）- 只接受 LINE 管理者帳號（簽章驗證 + LINE_ADMIN_USER_ID）

    Example: 非管理者開始新增時回覆無權限
      When 非管理者 LINE 帳號在 LINE 傳送：
        | type     | value           |
        | postback | add=project     |
      Then LINE 應回覆以下訊息：
        | contains       |
        | 這個帳號沒有操作權限 |
      And 管理者的 LINE 快速新增進度應不存在

  Rule: 前置（參數）- 選客戶：以快速回覆按鈕列出最近有異動的 12 位啟用中客戶，另提供「輸入關鍵字搜尋」

    Example: 開始新增時列出啟用中客戶
      When 管理者在 LINE 傳送：
        | type     | value       |
        | postback | add=project |
      Then LINE 回覆的快速回覆按鈕應為：
        | label      |
        | 青禾設計     |
        | 小森咖啡     |
        | 輸入關鍵字搜尋 |
        | 取消        |
      And 管理者的 LINE 快速新增進度應為：
        | step          |
        | choose_client |

    Example: 超過 12 位客戶時只列最近異動的 12 位
      Given 系統中另有 13 位啟用中客戶，最近異動時間各不相同
      When 管理者在 LINE 傳送：
        | type     | value       |
        | postback | add=project |
      Then LINE 回覆的客戶按鈕應為最近異動的 12 位

    Example: 以關鍵字搜尋客戶
      Given 管理者的 LINE 快速新增進度為：
        | step          | client | category | name | updated_at                |
        | choose_client |        |          |      | 2026-11-16T09:55:00+08:00 |
      When 管理者在 LINE 傳送：
        | type    | value |
        | message | 青禾    |
      Then LINE 回覆的快速回覆按鈕應為：
        | label |
        | 青禾設計 |
        | 取消   |

  Rule: 前置（參數）- 選類別：新網站、客製化外掛、BUG 排除、其他 四顆按鈕

    Example: 選好客戶後列出四個類別
      Given 管理者的 LINE 快速新增進度為：
        | step          | client | category | name | updated_at                |
        | choose_client |        |          |      | 2026-11-16T09:55:00+08:00 |
      When 管理者在 LINE 傳送：
        | type     | value         |
        | postback | client=青禾設計 |
      Then LINE 回覆的快速回覆按鈕應為：
        | label   |
        | 新網站    |
        | 客製化外掛 |
        | BUG 排除  |
        | 其他     |
        | 取消     |

  Rule: 前置（參數）- 輸入名稱：專案名稱不可為空白

    Example: 名稱只有空白時重新要求輸入
      Given 管理者的 LINE 快速新增進度為：
        | step       | client | category | name | updated_at                |
        | input_name | 青禾設計 | new_site |      | 2026-11-16T09:55:00+08:00 |
      When 管理者在 LINE 傳送：
        | type    | value |
        | message | "   " |
      Then LINE 應回覆以下訊息：
        | contains     |
        | 請輸入專案名稱 |
      And 管理者的 LINE 快速新增進度應為：
        | step       |
        | input_name |

  Rule: 前置（參數）- 選日期：以 LINE 日期選擇器選截止日，可按「略過」不設定

    Scenario Outline: 選日期或略過後建立專案
      Given 管理者的 LINE 快速新增進度為：
        | step            | client | category | name     | updated_at                |
        | choose_due_date | 青禾設計 | new_site | 青禾新官網 | 2026-11-16T09:55:00+08:00 |
      When 管理者在 LINE 傳送：
        | type   | value   |
        | <type> | <value> |
      Then 專案 "青禾新官網" 應為：
        | client | category | status      | due_date   |
        | 青禾設計 | new_site | not_started | <due_date> |

      Examples:
        | type     | value      | due_date   |
        | datetime | 2026-12-31 | 2026-12-31 |
        | postback | skip       |            |

  Rule: 前置（參數）- 客戶必須是既有客戶

    Example: 搜尋只找到停用客戶時不列出
      Given 管理者的 LINE 快速新增進度為：
        | step          | client | category | name | updated_at                |
        | choose_client |        |          |      | 2026-11-16T09:55:00+08:00 |
      When 管理者在 LINE 傳送：
        | type    | value |
        | message | 停用    |
      Then LINE 應回覆以下訊息：
        | contains       |
        | 找不到符合的客戶 |

  Rule: 前置（狀態）- 每一步都可按「取消」結束；超過 30 分鐘未回應時自動放棄，不建立專案

    Example: 按取消後結束且不建立專案
      Given 管理者的 LINE 快速新增進度為：
        | step       | client | category | name | updated_at                |
        | input_name | 青禾設計 | new_site |      | 2026-11-16T09:55:00+08:00 |
      When 管理者在 LINE 傳送：
        | type     | value  |
        | postback | cancel |
      Then LINE 應回覆以下訊息：
        | contains |
        | 已取消    |
      And 管理者的 LINE 快速新增進度應不存在

    Scenario Outline: 依閒置時間判斷進度是否過期
      Given 管理者的 LINE 快速新增進度為：
        | step       | client | category | name | updated_at   |
        | input_name | 青禾設計 | new_site |      | <updated_at> |
      When 管理者在 LINE 傳送：
        | type    | value  |
        | message | 青禾新官網 |
      Then LINE 應回覆以下訊息：
        | contains   |
        | <contains> |

      Examples:
        | updated_at                | contains           |
        | 2026-11-16T09:30:00+08:00 | 請選擇截止日          |
        | 2026-11-16T09:29:00+08:00 | 上一次新增已逾時，請重新開始 |

  Rule: 前置（狀態）- 問答途中傳入不符合該步驟的內容時，重新提示該步驟

    Example: 選類別時傳文字會重新提示
      Given 管理者的 LINE 快速新增進度為：
        | step            | client | category | name | updated_at                |
        | choose_category | 青禾設計 |          |      | 2026-11-16T09:55:00+08:00 |
      When 管理者在 LINE 傳送：
        | type    | value |
        | message | 網站    |
      Then LINE 應回覆以下訊息：
        | contains       |
        | 請點選下方類別按鈕 |
      And 管理者的 LINE 快速新增進度應為：
        | step            |
        | choose_category |

  Rule: 後置（狀態）- 建立規則與網頁後台建立專案相同（狀態為待開始、截止日寫入「專案管理」日曆）

    Example: LINE 新增的專案寫入專案管理日曆
      Given 管理者的 LINE 快速新增進度為：
        | step            | client | category | name     | updated_at                |
        | choose_due_date | 青禾設計 | new_site | 青禾新官網 | 2026-11-16T09:55:00+08:00 |
      When 管理者在 LINE 傳送：
        | type     | value      |
        | datetime | 2026-12-31 |
      Then 「專案管理」日曆應有以下事件：
        | title                  | date       |
        | 【專案截止】青禾設計 · 青禾新官網 | 2026-12-31 |
      And 管理者的 LINE 快速新增進度應不存在

  Rule: 後置（回應）- 建立成功後回覆專案摘要與後台連結

    Example: 建立成功後回覆摘要
      Given 管理者的 LINE 快速新增進度為：
        | step            | client | category | name     | updated_at                |
        | choose_due_date | 青禾設計 | new_site | 青禾新官網 | 2026-11-16T09:55:00+08:00 |
      When 管理者在 LINE 傳送：
        | type     | value      |
        | datetime | 2026-12-31 |
      Then LINE 應回覆以下訊息：
        | contains                              |
        | 已建立：青禾設計 · 青禾新官網（新網站，12/31 截止） |
        | /projects/                            |
