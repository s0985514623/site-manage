#!/usr/bin/env bash
#
# 初始化一台全新的 Ubuntu 24.04 VPS，讓 GitHub Actions 可以部署上來。
#
# 會做的事：防火牆、swap、Docker、Caddy（自動 HTTPS）、部署使用者、
# /srv/site-support/.env、排程與每日資料庫備份。應用程式本身由 deploy.yml 部署。
#
# 執行（在 VPS 上，以 root）：
#   DOMAIN=app.example.com \
#   DEPLOY_PUBKEY="ssh-ed25519 AAAA... github-actions" \
#   ALLOWED_EMAILS=you@example.com \
#   bash vps-init.sh
#
# 重複執行是安全的：已存在的 .env 絕不覆蓋 —— 重新產生 ENCRYPTION_KEY
# 等於讓所有已加密的帳密永久無法還原。

set -euo pipefail

APP_USER=deploy
APP_DIR=/srv/site-support
BACKUP_DIR=/var/backups/site-support
SWAP_FILE=/swapfile
SWAP_THRESHOLD_MB=3500

log() { printf '\n==> %s\n' "$*"; }
die() { printf '錯誤：%s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die '請以 root 執行'
[[ -n ${DOMAIN:-} ]] || die '缺少 DOMAIN，例如 DOMAIN=app.example.com'
[[ $DOMAIN =~ ^[A-Za-z0-9.-]+$ ]] || die "DOMAIN 格式不正確：$DOMAIN"
[[ ${DEPLOY_PUBKEY:-} =~ ^ssh-(ed25519|rsa)[[:space:]] ]] || die '缺少 DEPLOY_PUBKEY，或它不是 SSH 公鑰'
[[ -n ${ALLOWED_EMAILS:-} ]] || die '缺少 ALLOWED_EMAILS，留空的話所有人都無法登入'

# shellcheck disable=SC1091
. /etc/os-release
[[ ${ID:-} == ubuntu ]] || die "這支腳本只支援 Ubuntu，目前是 ${ID:-未知}"

export DEBIAN_FRONTEND=noninteractive

# ------------------------------------------------------------------ 系統 --
log '安裝系統套件與自動安全更新'
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg openssh-server openssl ufw cron unattended-upgrades >/dev/null
systemctl enable --now cron unattended-upgrades >/dev/null

# 排程時間與報價單日期都以台北時間為準
timedatectl set-timezone Asia/Taipei

ram_mb=$(awk '/MemTotal/ { print int($2 / 1024) }' /proc/meminfo)
if [[ $ram_mb -lt $SWAP_THRESHOLD_MB ]] && [[ -z $(swapon --noheadings) ]]; then
  log "記憶體 ${ram_mb} MB，建立 2 GB swap 吸收產 PDF 時的峰值"
  fallocate -l 2G "$SWAP_FILE"
  chmod 600 "$SWAP_FILE"
  mkswap "$SWAP_FILE" >/dev/null
  swapon "$SWAP_FILE"
  grep -q "^$SWAP_FILE " /etc/fstab || echo "$SWAP_FILE none swap sw 0 0" >>/etc/fstab
fi

# ---------------------------------------------------------------- 防火牆 --
log '設定防火牆（只開 SSH、80、443）'
ssh_port=$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2; exit }' || true)
ufw allow "${ssh_port:-22}/tcp" >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

# ---------------------------------------------------------------- Docker --
if ! command -v docker >/dev/null; then
  log '安裝 Docker'
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
fi
systemctl enable --now docker >/dev/null

# ----------------------------------------------------------------- Caddy --
if ! command -v caddy >/dev/null; then
  log '安裝 Caddy'
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  chmod a+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  echo 'deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main' \
    >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

log "設定 Caddy：https://$DOMAIN → 127.0.0.1:3000"
cat >/etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
  || die 'Caddyfile 驗證失敗'
systemctl enable caddy >/dev/null
systemctl reload-or-restart caddy

# ------------------------------------------------------------ 部署使用者 --
log "建立部署使用者 $APP_USER"
id "$APP_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$APP_USER"
usermod -aG docker "$APP_USER"

key_file="/home/$APP_USER/.ssh/authorized_keys"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.ssh"
touch "$key_file"
grep -qxF "$DEPLOY_PUBKEY" "$key_file" || echo "$DEPLOY_PUBKEY" >>"$key_file"
chown "$APP_USER:$APP_USER" "$key_file"
chmod 600 "$key_file"

install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$BACKUP_DIR"

# ------------------------------------------------------------------ .env --
env_file="$APP_DIR/.env"
env_created=no
if [[ -e $env_file ]]; then
  log "$env_file 已存在，不動它"
else
  log "產生 $env_file"
  postgres_password=$(openssl rand -hex 24)
  # 建立時就限制權限，檔案不會有任何一刻是其他人讀得到的
  (
    umask 077
    cat >"$env_file" <<EOF
# 由 scripts/vps-init.sh 產生。APP_IMAGE 由 deploy.yml 在每次部署時更新。
APP_IMAGE=

POSTGRES_USER=site_support
POSTGRES_PASSWORD=$postgres_password
POSTGRES_DB=site_support
DATABASE_URL=postgresql://site_support:$postgres_password@postgres:5432/site_support

APP_URL=https://$DOMAIN
TZ=Asia/Taipei

AUTH_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)
CRON_SECRET=$(openssl rand -hex 32)

# 以下需要手動填，填完執行：docker compose -f docker-compose.prod.yml up -d app
ALLOWED_EMAILS=$ALLOWED_EMAILS
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=

RESEND_API_KEY=
MAIL_FROM=
NOTIFY_TO=

LINE_CHANNEL_ACCESS_TOKEN=
LINE_CHANNEL_SECRET=
LINE_ADMIN_USER_ID=
EOF
  )
  env_created=yes
fi
chown "$APP_USER:$APP_USER" "$env_file"
chmod 600 "$env_file"

# ------------------------------------------------------------------ 排程 --
log '安裝排程與備份'
cat >/usr/local/bin/site-support-cron <<EOF
#!/usr/bin/env bash
# 呼叫 /api/cron/<端點>。直接打本機的 3000，不必繞過公開的 HTTPS。
set -euo pipefail
secret=\$(sed -n 's/^CRON_SECRET=//p' $env_file)
# 密鑰走 stdin，才不會出現在 ps 看得到的命令列參數裡
printf 'Authorization: Bearer %s\n' "\$secret" \\
  | curl -fsS --max-time 320 -H @- "http://127.0.0.1:3000/api/cron/\$1" \\
  | cut -c1-500
EOF

cat >/usr/local/bin/site-support-backup <<EOF
#!/usr/bin/env bash
# 每日 pg_dump，保留 14 天。回簽報價單以 bytea 存在資料庫裡，這份備份也包含它們。
set -euo pipefail
cd $APP_DIR
[[ -f docker-compose.prod.yml ]] || { echo '尚未部署，略過備份'; exit 0; }
target="$BACKUP_DIR/site-support-\$(date +%F).dump"
# 先寫暫存檔：pg_dump 中途失敗時，不留下看起來正常的半截備份
docker compose -f docker-compose.prod.yml exec -T postgres \\
  sh -c 'pg_dump -U "\$POSTGRES_USER" -d "\$POSTGRES_DB" --format=custom' >"\$target.tmp"
mv "\$target.tmp" "\$target"
find $BACKUP_DIR -name 'site-support-*.dump' -mtime +14 -delete
echo "備份完成：\$target"
EOF
chmod 755 /usr/local/bin/site-support-cron /usr/local/bin/site-support-backup

# 時間皆為台北時間，輸出進 syslog：journalctl -t site-support
cat >/etc/cron.d/site-support <<EOF
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
0 3 * * * $APP_USER site-support-backup 2>&1 | logger -t site-support
0 4 * * * $APP_USER site-support-cron gcal-sync 2>&1 | logger -t site-support
0 8 * * 1 $APP_USER site-support-cron detect 2>&1 | logger -t site-support
0 9 * * * $APP_USER site-support-cron expiry-scan 2>&1 | logger -t site-support
30 9 * * * $APP_USER site-support-cron quote-draft 2>&1 | logger -t site-support
15 * * * * $APP_USER site-support-cron uptime 2>&1 | logger -t site-support
EOF
chmod 644 /etc/cron.d/site-support

# ------------------------------------------------------------------ 完成 --
log '初始化完成'
cat <<EOF

還需要你手動做的事：

1. 把 DNS 的 $DOMAIN A 紀錄指向這台機器（Caddy 才申請得到憑證）
2. 填寫 $env_file 裡標示手動填的欄位：Google 登入、Resend、LINE
3. 在 GitHub repo 設定 Secrets：
     SSH_HOST         $DOMAIN
     SSH_USER         $APP_USER
     SSH_KEY          部署金鑰的私鑰
     SSH_KNOWN_HOSTS  在自己電腦執行 ssh-keyscan -H $DOMAIN 的輸出
     DEPLOY_PATH      $APP_DIR
EOF

if [[ $env_created == yes ]]; then
  cat <<EOF

4. 【極重要】把 ENCRYPTION_KEY 另存到密碼管理器：
     grep ^ENCRYPTION_KEY= $env_file
   這把金鑰遺失，所有加密的主機帳密與 Auth Code 都無法還原，備份也救不回來。
EOF
fi

printf '\n提醒：確認金鑰登入可用後，建議關閉 SSH 密碼登入。\n'
printf '提醒：備份只存在這台機器上，機器毀損就會一起消失，請另外定期複製到異地。\n'
