# 部署：site-manager 接上共用 VPS

> 依 `D:\Dev\line-accounting\deploy\SHARED-VPS-SPEC.md`。VPS 主機、`deploy` 帳號、Docker、共用 Caddy、共用 PostgreSQL、
> ufw / Linode 防火牆**都已由 accounting 完成，這裡不重做**。這裡只列 site-manager 要做的事。
> `$` = VPS（管理員帳號 bash），`PS>` = Windows 開發機 PowerShell。每步：指令 → 預期結果。

## 本目錄

| 檔案 | 用途 | 安裝到 VPS |
| --- | --- | --- |
| `deploy.sh` | SSH forced command（與 accounting 同一份範本，`APP=site-manager`） | `/opt/my-services/apps/site-manager/deploy.sh` |
| `docker-compose.yml` | compose 範本（使用者管理，deploy.sh 不覆寫） | `/opt/my-services/apps/site-manager/docker-compose.yml` |
| `Caddyfile.site-manager` | 共用 Caddyfile 要加的站台區塊 | 併入 `/opt/my-services/infra` 的 Caddyfile |
| `backup.sh` | 每日 pg_dump 本 app 的 database | `/opt/my-services/apps/site-manager/backup.sh` |
| `systemd/*` | 8 支排程 timer + 每日備份 timer | `/etc/systemd/system/` |

## 與 accounting 的差異

| 項目 | accounting | site-manager |
| --- | --- | --- |
| 映像 | `ghcr.io/s0985514623/line-accounting` | `ghcr.io/s0985514623/site-manage`（repo 名稱 `site-manage`） |
| 資料庫 | database/role `accounting` | database/role **`site_manager`**（底線：PostgreSQL 識別字不能有 `-`） |
| pre-deploy | `prisma migrate deploy` + seed | `node scripts/migrate.mjs`（drizzle migrator） |
| 健康檢查 | `/healthz` | `/healthz`（`src/app/healthz/route.ts`，SELECT 1，逾時 3 秒回 503） |
| 排程 | 無 | 8 支 systemd timer，在容器內跑 `node scripts/run-cron.mjs <端點>` |
| 備份 | （另行處理） | `site-manager-backup.timer` 每日 03:00 → `backups/`，保留 14 天 |
| Caddy | `reverse_proxy accounting-app:3000` | 同上 + `/api/cron/*` 對外 `respond 404` |
| LINE | Messaging API + LINE Login / LIFF | **只有 Messaging API** |
| Google | — | 登入（Auth.js）+ Google Calendar，兩組 redirect URI |

### 排程時間（台北時間）

| timer | 時間 | 端點 |
| --- | --- | --- |
| `site-manager-backup` | 每日 03:00 | `backup.sh` |
| `site-manager-cron-gcal-sync` | 每日 04:00 | `/api/cron/gcal-sync` |
| `site-manager-cron-detect` | 每週一 08:00 | `/api/cron/detect` |
| `site-manager-cron-expiry-scan` | 每日 09:00 | `/api/cron/expiry-scan` |
| `site-manager-cron-quote-draft` | 每日 09:30 | `/api/cron/quote-draft` |
| `site-manager-cron-uptime` | 每小時 :15 | `/api/cron/uptime` |
| `site-manager-cron-weekly-report` | 每週一 09:00 | `/api/cron/weekly-report` |
| `site-manager-cron-quote-followup` | 每日 09:40 | `/api/cron/quote-followup` |
| `site-manager-cron-payment-followup` | 每日 09:45 | `/api/cron/payment-followup` |

8 支排程成功跑完都會通知外部監控主機（`.env` 的 `HEARTBEAT_URL`、`HEARTBEAT_TOKEN`，留空則不送）。
之後新增排程：複製一支 `.timer` 改名、改 `OnCalendar` 與 `Unit=site-manager-cron@<端點>.service` 即可，service 不用新增。

---

## A. DNS（約 5 分鐘 + 生效時間，最先做）

1. DNS 管理後台新增 A 記錄：`site-manager.ren-codes.com` → `139.162.95.207`
2. `PS> nslookup site-manager.ren-codes.com` → 預期：回 `139.162.95.207`

## B. GitHub repo（約 10 分鐘）

3. GitHub 建 **private** repo `s0985514623/site-manage`（名稱要一致：映像是 `ghcr.io/s0985514623/site-manage`）
4. `PS> cd D:\Dev\site-support; git remote add origin https://github.com/s0985514623/site-manage.git`
   → **先不要 push main**（等 E 節設好；否則第一次 push 會跑 deploy 並失敗）

## C. VPS：資料庫（約 5 分鐘）

5. 產生密碼並存到共用 secrets：
   ```bash
   $ openssl rand -hex 24 | sudo tee /opt/my-services/secrets/site_manager_db_password >/dev/null
   $ sudo chmod 600 /opt/my-services/secrets/site_manager_db_password
   ```
6. 建 role 與 database：
   ```bash
   $ docker exec -it infra-postgres-1 psql -U <superuser>
   ```
   ```sql
   CREATE ROLE site_manager LOGIN PASSWORD '<步驟 5 的密碼>';
   CREATE DATABASE site_manager OWNER site_manager;
   REVOKE ALL ON DATABASE site_manager FROM PUBLIC;
   ```
   → 預期：`\l` 看得到 `site_manager`，owner 為 `site_manager`
7. 建網路並讓 Postgres 加入（`db_site_manager` 為 internal，寫法照 `db_accounting`）：
   ```bash
   $ docker network create --internal db_site_manager
   ```
   infra compose 的 postgres service 加入 `db_site_manager` 網路 → `cd /opt/my-services/infra && docker compose up -d postgres`
   → 預期：`docker network inspect db_site_manager --format '{{range .Containers}}{{.Name}} {{end}}'` 含 `infra-postgres-1`

## D. VPS：目錄、compose、.env（約 15 分鐘）

8. `$ sudo install -d -o deploy -g deploy -m 750 /opt/my-services/apps/site-manager /opt/my-services/apps/site-manager/backups`
9. 上傳範本與腳本：
   ```powershell
   PS> scp -P 22 D:\Dev\site-support\deploy\docker-compose.yml D:\Dev\site-support\deploy\deploy.sh D:\Dev\site-support\deploy\backup.sh <admin>@139.162.95.207:/tmp/
   ```
   ```bash
   $ cd /opt/my-services/apps/site-manager
   $ sudo install -o deploy -g deploy -m 644 /tmp/docker-compose.yml docker-compose.yml
   $ sudo install -o deploy -g deploy -m 755 /tmp/deploy.sh deploy.sh
   $ sudo install -o deploy -g deploy -m 755 /tmp/backup.sh backup.sh
   $ rm /tmp/docker-compose.yml /tmp/deploy.sh /tmp/backup.sh
   $ head -1 deploy.sh backup.sh | od -c | grep '\\r' || echo 'LF OK'
   ```
   → 預期：`LF OK`；打開 compose 比對 accounting 的檔案，`networks` 的 external 宣告方式要一致
10. `$ sudo -u deploy nano /opt/my-services/apps/site-manager/.env`，內容：
    ```dotenv
    NODE_ENV=production
    APP_URL=https://site-manager.ren-codes.com
    # Auth.js 在容器內會把自己當成 0.0.0.0:3000，必須明確指定對外網址，否則 Google 登入回 error=Configuration
    AUTH_URL=https://site-manager.ren-codes.com
    AUTH_TRUST_HOST=true
    TZ=Asia/Taipei
    # 密碼含特殊字元時要 URL encode；步驟 5 用 hex 產生，不需要
    DATABASE_URL=postgresql://site_manager:<步驟 5 的密碼>@postgres:5432/site_manager

    # AUTH_SECRET、CRON_SECRET：在 VPS 上各跑一次 openssl 產生，不要沿用本機的值
    AUTH_SECRET=<openssl rand -base64 32>
    CRON_SECRET=<openssl rand -hex 32>
    # ENCRYPTION_KEY：要匯入本機資料時「必須沿用本機 .env.local 的值」，否則帳密解不開；
    # 全新空資料庫才用 openssl rand -base64 32 產生
    ENCRYPTION_KEY=<本機 .env.local 的 ENCRYPTION_KEY>

    ALLOWED_EMAILS=<你的 Google 帳號 Email>
    AUTH_GOOGLE_ID=...
    AUTH_GOOGLE_SECRET=...

    RESEND_API_KEY=...
    MAIL_FROM=冠澄數位行銷 <service@ren-codes.com>
    NOTIFY_TO=<你的 Email>

    LINE_CHANNEL_ACCESS_TOKEN=...
    LINE_CHANNEL_SECRET=...
    LINE_ADMIN_USER_ID=U...

    # 外部監控主機（PHP）的心跳端點，見 tools/php-monitor/README.md；先留空也可以
    HEARTBEAT_URL=
    HEARTBEAT_TOKEN=
    ```
11. `$ sudo chown deploy:deploy .env && sudo chmod 600 .env` → 預期：`ls -l` 顯示 `-rw------- deploy deploy`（accounting 踩過 root:root 的坑）
12. **【極重要】** 把 `ENCRYPTION_KEY` 另存到密碼管理器：`$ sudo grep ^ENCRYPTION_KEY= .env`
    → 這把金鑰遺失，所有加密的主機帳密與 Auth Code 都無法還原，備份也救不回來。

## E. 部署金鑰 + GitHub Environment（約 15 分鐘）

13. 產生 site-manager 專用金鑰（不可與 accounting / calendar 共用）：
    ```powershell
    PS> ssh-keygen -t ed25519 -C "gha-deploy-site-manager" -N '' -f "$HOME\.ssh\site-manager_deploy"
    ```
14. VPS `/home/deploy/.ssh/authorized_keys` 追加**一行**：
    ```text
    command="/opt/my-services/apps/site-manager/deploy.sh",restrict ssh-ed25519 AAAA...（site-manager_deploy.pub 第二欄） gha-deploy-site-manager
    ```
15. 驗證：`PS> ssh -i "$HOME\.ssh\site-manager_deploy" -p 22 deploy@139.162.95.207 "ls"` → 預期：`forbidden`
16. GitHub repo → Settings → Environments → New environment `production`（Deployment branches 限 `main`）：

    | 類型 | 名稱 | 值 |
    | --- | --- | --- |
    | Secret | `VPS_HOST` | `139.162.95.207`（同 accounting） |
    | Secret | `VPS_PORT` | `22`（同 accounting） |
    | Secret | `VPS_USER` | `deploy`（同 accounting） |
    | Secret | `VPS_KNOWN_HOSTS` | 直接沿用 accounting 的值 |
    | Secret | `VPS_SSH_KEY` | `site-manager_deploy`（**私鑰**）完整內容 |
    | Variable | `APP_DOMAIN` | `site-manager.ren-codes.com`（不含 `https://`） |

17. 設定完成後，開發機上的 `site-manager_deploy` 私鑰刪除或妥善保存（只需存在 GitHub Secret）。

## F. VPS：Caddy（約 10 分鐘）

18. `$ docker network create proxy_site_manager`（若 infra 是用 compose 宣告網路，改照 `proxy_accounting` 的寫法）
19. infra compose 的 Caddy service 加入 `proxy_site_manager` 網路
20. `infra/.env` 加：`SITE_MANAGER_DOMAIN=site-manager.ren-codes.com`
21. 把 `deploy/Caddyfile.site-manager` 區塊貼進 infra 的 Caddyfile（放在 accounting、calendar 區塊後面）
22. `$ cd /opt/my-services/infra && docker compose up -d caddy && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`
    → 預期：無錯誤；`docker compose logs caddy --tail 20` 看到 `site-manager.ren-codes.com` 憑證申請成功（DNS 生效後）

## G. 首次部署（約 10 分鐘）

23. `PS> git push -u origin main` → Actions「Deploy」：CI → build → deploy → public smoke 全綠
24. GHCR：第一次 push 後 Package settings → Manage Actions access，確認 `site-manage` repo 有 **Read**
25. 驗證：
    ```bash
    $ cd /opt/my-services/apps/site-manager && cat .last_good_tag && tail -n 20 deploy.log
    $ curl -fsS https://site-manager.ren-codes.com/healthz        # {"status":"ok"}
    $ curl -s -o /dev/null -w '%{http_code}\n' https://site-manager.ren-codes.com/api/cron/uptime   # 404
    ```
26. 建公司資料（只需一次）：`db:seed-company` 是開發用的 tsx 腳本，不在正式映像裡。
    到後台設定頁手動填乙方公司資料、匯款帳戶、方案範本、續約條款（內容可參考 `scripts/seed-company.ts`）。

## H. 排程與備份（約 10 分鐘，首次部署成功後）

27. 上傳並啟用 systemd unit：
    ```powershell
    PS> scp -P 22 D:\Dev\site-support\deploy\systemd\* <admin>@139.162.95.207:/tmp/sm-systemd/
    ```
    ```bash
    $ sudo install -m 644 /tmp/sm-systemd/site-manager-* /etc/systemd/system/ && rm -r /tmp/sm-systemd
    $ sudo systemctl daemon-reload
    $ sudo systemctl enable --now site-manager-backup.timer site-manager-cron-{gcal-sync,detect,expiry-scan,quote-draft,uptime,weekly-report,quote-followup,payment-followup}.timer
    $ systemctl list-timers 'site-manager-*'
    ```
    → 預期：列出 9 支 timer（8 支排程 + 備份）與下次執行時間
28. 手動跑一次確認：
    ```bash
    $ sudo systemctl start site-manager-cron@uptime.service && journalctl -u site-manager-cron@uptime -n 5
    $ sudo systemctl start site-manager-backup.service && ls -lh /opt/my-services/apps/site-manager/backups
    ```
    → 預期：`uptime HTTP 200 ...`；backups 下有今天的 `.dump`
    → 若備份出現 `password authentication failed`：infra Postgres 的 `pg_hba` 沒開 local trust，
      改成 `docker exec -e PGPASSWORD=... infra-postgres-1 pg_dump ...`（密碼從 `/opt/my-services/secrets` 讀）

## I. 串接外部授權（約 20 分鐘，首次部署成功後）

29. **Google OAuth**（Google Cloud Console → API 與服務 → 憑證 → 該 OAuth 用戶端）→ 已授權的重新導向 URI 加兩筆：
    - `https://site-manager.ren-codes.com/api/auth/callback/google`（登入）
    - `https://site-manager.ren-codes.com/api/google/calendar/callback`（Google Calendar）
    → 預期：用白名單 Email 能登入後台
30. **Google Calendar**：後台設定頁按「連結 Google Calendar」完成授權（正式環境的 token 要重新授權一次，本機的不能沿用）
31. **LINE Messaging API**（LINE Developers Console → 該 channel）：
    - Webhook URL：`https://site-manager.ren-codes.com/api/line/webhook` → **Use webhook：On** → Verify
    - Webhook redelivery：**Off**
    - LINE Official Account Manager → 回應設定：關閉「自動回應訊息」
    → 預期：Verify 成功；傳任何訊息給官方帳號會收到「要做什麼？」和四顆按鈕
    - 建立聊天室下方的常駐選單（一次性，可重跑）：在開發機執行
      `PS> $env:LINE_CHANNEL_ACCESS_TOKEN='<正式的 token>'; npm run line:richmenu`
      → 預期：`✓ 已建立並設為預設選單`；手機重新打開聊天室會看到四格選單
32. **Resend**：確認 `MAIL_FROM` 的網域已驗證（SPF / DKIM）→ 後台寄一封測試報價給自己

---

## 回滾

- **手動（建議）**：Actions → Deploy → Run workflow → `tag` 填目標版本的完整 commit sha。不重新建置。
- **緊急（VPS 上）**：
  ```bash
  $ cd /opt/my-services/apps/site-manager
  $ sudo -u deploy env APP_IMAGE="ghcr.io/s0985514623/site-manage:$(cat .last_good_tag)" \
      docker compose -p site-manager -f docker-compose.yml up -d --no-deps app
  ```
- 回滾**不回滾 migration**：migration 必須向後相容（先 expand、下一版再 contract）。

## 疑難排解

| 現象 | 原因 / 處理 |
| --- | --- |
| `forbidden` / `bad tag` / `bad actor` | SSH 指令格式錯，或 actor 為 `xxx[bot]` |
| exit 75 `deploy in progress` | 另一個部署持有 `.deploy.lock` |
| pull `denied` / `unauthorized` | GHCR package 未給 `site-manage` repo Read 權限（G 節步驟 24） |
| migration 失敗 | 服務未被更動；檢查 `.env` 的 `DATABASE_URL` 與 `db_site_manager` 網路 |
| 502（Caddy） | Caddy 未加入 `proxy_site_manager`，或 compose 的 alias 不是 `site-manager-app` |
| 容器起來就退出、log 有「環境變數設定有誤」 | `.env` 缺必填值（`src/lib/env.ts`），`ENCRYPTION_KEY` 必須是 32 bytes base64 |
| 排程沒跑 | `systemctl list-timers 'site-manager-*'`、`journalctl -u 'site-manager-cron@*' --since today` |
