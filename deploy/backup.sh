#!/usr/bin/env bash
# site-manager — 每日資料庫備份（由 site-manager-backup.timer 03:00 觸發）
#
# 安裝位置：/opt/my-services/apps/site-manager/backup.sh（owner deploy，755）
# 輸出：/opt/my-services/apps/site-manager/backups/site-manager-YYYY-MM-DD.dump，保留 14 天
#
# 只備份本 app 的 database（site_manager），不碰其他 app。
# 客戶回簽的報價單 PDF 以 bytea 存在資料庫裡，這份備份也包含它們。
# 備份只存在這台機器上，機器毀損就會一起消失，請另外定期複製到異地。
set -Eeuo pipefail

PG_CONTAINER=infra-postgres-1
DB=site_manager
BACKUP_DIR=/opt/my-services/apps/site-manager/backups
KEEP_DAYS=14

target="$BACKUP_DIR/site-manager-$(date +%F).dump"

# 先寫暫存檔：pg_dump 中途失敗時，不留下看起來正常的半截備份
docker exec "$PG_CONTAINER" pg_dump -U "$DB" -d "$DB" --format=custom > "$target.tmp"
mv "$target.tmp" "$target"
find "$BACKUP_DIR" -name 'site-manager-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "備份完成：$target（$(du -h "$target" | cut -f1)）"
