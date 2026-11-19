# site-manager 外部監控（PHP）

放在**另一台主機**上，負責在 VPS 整台停掉、或排程默默停擺時通知你。
VPS 自己停了就發不出任何告警，所以這件事一定要由外部主機來做。

| 檔案 | 用途 |
| --- | --- |
| `heartbeat.php` | 對外開放。site-manager 每支排程成功後 `POST ?job=<名稱>`，記下時間 |
| `check.php` | 主機 cron 每 15 分鐘跑：檢查 `/healthz` 與各排程心跳，有問題發 LINE + Email |
| `lib.php` | 共用函式（門檻判斷、去重、LINE、Email） |
| `config.example.php` | 設定範本，複製成 `config.php` |
| `.htaccess` | 只開放 `heartbeat.php`；設定、狀態檔、測試都擋掉 |
| `tests/run.php` | 門檻與去重的測試：`php tests/run.php` |

需求：PHP 8.1+、curl 擴充、可以設 cron 的主機（一般虛擬主機即可）。不需要資料庫，狀態存在 `data/state.json`。

## 告警規則

- `/healthz` 連不上或不是 200 → 告警（主機停機、資料庫斷線）
- 排程超過門檻沒回報 → 告警。門檻：每日排程 26 小時、每週排程 8 天、uptime（每 15 分鐘）1 小時
- 同一個問題同一天只告警一次；問題消失時發一則「已恢復」
- LINE 與 Email 都送不出去時不算已告警，下一輪（15 分鐘後）再試

## 安裝（約 15 分鐘）

1. 把整個 `tools/php-monitor/` 上傳到 PHP 主機，例如 `https://<你的網域>/site-monitor/`
2. 產生共用 token：`openssl rand -hex 32`（或任一 64 字元亂數）
3. 複製 `config.example.php` 為 `config.php`，填入：
   - `token`：上一步的 token
   - `health_url`：`https://site-manager.ren-codes.com/healthz`
   - `line_token`、`line_to`：可沿用 site-manager 的 `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_ADMIN_USER_ID`
   - `mail_to`：收告警的 Email
4. 確認擋得住：瀏覽器開 `https://<你的網域>/site-monitor/config.php` → 預期 403
5. 主機 cron 加一行（每 15 分鐘）：
   ```
   */15 * * * * php /path/to/site-monitor/check.php
   ```
6. 回到 VPS，在 `/opt/my-services/apps/site-manager/.env` 填：
   ```dotenv
   HEARTBEAT_URL=https://<你的網域>/site-monitor/heartbeat.php
   HEARTBEAT_TOKEN=<第 2 步的 token>
   ```
   然後重啟 app（必須在該目錄、必須帶 `APP_IMAGE`，否則會退回 whoami 佔位映像）：
   ```bash
   cd /opt/my-services/apps/site-manager
   sudo -u deploy env APP_IMAGE="ghcr.io/s0985514623/site-manage:$(cat .last_good_tag)" docker compose -p site-manager -f docker-compose.yml up -d --no-deps app
   ```
7. 驗證：VPS 上 `sudo systemctl start site-manager-cron@uptime.service`，
   PHP 主機的 `data/state.json` 會出現 `"uptime": <時間>`

## 手動測試告警

- 暫時把 `config.php` 的 `health_url` 改成錯的網址，執行 `php check.php` → 應收到「健康檢查連不上」
- 改回正確網址再跑一次 → 應收到「已恢復」
