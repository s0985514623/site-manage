#!/usr/bin/env bash
# site-manager — VPS 部署腳本（SHARED-VPS-SPEC §6.2，與 accounting / calendar 同一份範本）
#
# 安裝位置：/opt/my-services/apps/site-manager/deploy.sh（owner deploy，755）
# 呼叫方式：SSH forced command（authorized_keys 的 command="…"），由 GitHub Actions 執行
#   echo "$GITHUB_TOKEN" | ssh deploy@<vps> "deploy <git-sha> <github-actor>"
#
# 流程：驗證參數 → flock → docker login → pull → migration → up -d → 等 healthy（約 90 秒）
#       → 成功寫 .last_good_tag 並清本 app 舊映像 → 失敗印 logs 並回滾到 .last_good_tag
#
# 注意：回滾不回滾 migration，migration 必須向後相容（先 expand、下一版再 contract）。
#       本檔是版本控制來源；VPS 上的副本要手動更新（forced command 刻意不允許 scp）。
set -Eeuo pipefail

# ---- 每個 app 修改這裡 -------------------------------------------------------------
APP=site-manager                            # compose project 名稱 = 目錄名
IMAGE=ghcr.io/s0985514623/site-manage
SERVICE=app
KEEP_IMAGES=5
# ------------------------------------------------------------------------------------

APP_DIR=/opt/my-services/apps/$APP
COMPOSE_FILE="$APP_DIR/docker-compose.yml"
HEALTH_TRIES=30   # × 3 秒 ≈ 90 秒
HEALTH_INTERVAL=3
COMPOSE=(docker compose -p "$APP" -f "$COMPOSE_FILE")

# 部署前指令（在新映像中執行，失敗則不更動服務）
pre_deploy() {
  "${COMPOSE[@]}" run --rm -T --no-deps "$SERVICE" node scripts/migrate.mjs < /dev/null
}

CMD="" TAG="" ACTOR=""
read -r CMD TAG ACTOR _ <<< "${SSH_ORIGINAL_COMMAND:-}" || true
[[ "$CMD" == "deploy" ]] || { echo "forbidden" >&2; exit 2; }
[[ "$TAG" =~ ^[0-9a-f]{7,40}$ ]] || { echo "bad tag" >&2; exit 2; }
[[ "$ACTOR" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,38}$ ]] || { echo "bad actor" >&2; exit 2; }
[[ -f "$COMPOSE_FILE" ]] || { echo "missing $COMPOSE_FILE" >&2; exit 2; }

exec 9>"$APP_DIR/.deploy.lock"
flock -n 9 || { echo "deploy in progress" >&2; exit 75; }

log() { echo "[$(date -Is)] $*" | tee -a "$APP_DIR/deploy.log"; }

wait_healthy() {
  local cid status i
  for ((i = 1; i <= HEALTH_TRIES; i++)); do
    cid="$("${COMPOSE[@]}" ps -q "$SERVICE" 2>/dev/null || true)"
    if [[ -n "$cid" ]]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
      case "$status" in
        healthy) return 0 ;;
        unhealthy | exited | dead) log "container status=$status"; return 1 ;;
      esac
    fi
    sleep "$HEALTH_INTERVAL"
  done
  log "health check timeout"; return 1
}

# 共用 VPS：只清本 app 的映像，絕不可用 `docker image prune -a`
prune_images() {
  local old
  docker images "$IMAGE" --format '{{.Tag}}' \
    | grep -vx -e "$TAG" -e '<none>' \
    | tail -n +"$KEEP_IMAGES" \
    | while read -r old; do docker rmi "$IMAGE:$old" >/dev/null 2>&1 || true; done
}

docker login ghcr.io -u "$ACTOR" --password-stdin >/dev/null
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

log "deploy $TAG by $ACTOR"
docker pull --quiet "$IMAGE:$TAG"
export APP_IMAGE="$IMAGE:$TAG"

log "pre-deploy（migration）"
if ! pre_deploy; then log "FAILED pre-deploy $TAG（服務未變更）"; exit 1; fi

log "up"
if "${COMPOSE[@]}" up -d --no-deps "$SERVICE" && wait_healthy; then
  echo "$TAG" > "$APP_DIR/.last_good_tag"
  log "healthy $TAG"
  prune_images || true
  exit 0
fi

log "UNHEALTHY $TAG"
"${COMPOSE[@]}" logs --no-color --tail 100 "$SERVICE" || true
if [[ -f "$APP_DIR/.last_good_tag" ]]; then
  PREV="$(< "$APP_DIR/.last_good_tag")"
  if [[ "$PREV" =~ ^[0-9a-f]{7,40}$ ]]; then
    log "rollback → $PREV"
    export APP_IMAGE="$IMAGE:$PREV"
    "${COMPOSE[@]}" up -d --no-deps "$SERVICE" || true
    if wait_healthy; then log "rollback healthy $PREV"; else log "rollback UNHEALTHY $PREV（需人工處理）"; fi
  else
    log ".last_good_tag 內容無效，不回滾"
  fi
else
  log "無 .last_good_tag（首次部署），不回滾"
fi
exit 1
