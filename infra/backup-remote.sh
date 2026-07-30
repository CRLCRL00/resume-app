#!/bin/bash
# R41-Gap-13: rclone remote backup — 把本地 /var/backups/resume-app 同步到远端
#
# 用法：bash infra/backup-remote.sh   （每日 cron 后跑）
# install cron：
#   echo '15 3 * * * root /opt/resume-app/infra/backup-remote.sh' >> existing backup cron line
#   或单独：echo '15 3 * * * root /opt/resume-app/infra/backup-remote.sh' > /etc/cron.d/backup-remote
#
# 配置：
#   RCLONE_REMOTE_NAME=onedrive-or-s3          rclone remote 名（运维先 rclone config 配）
#   RCLONE_REMOTE_PATH=resume-app-backups      远端目录
#   BACKUP_LOCAL=/var/backups/resume-app       本地目录
#   RETAIN_DAYS=30                              远端保留天数
#
# 不做（留给 L2/L3）：
#   - 加密 backup 内容（rclone crypt 由配置决定）
#   - 多 region 跨 cloud 容灾
#   - backup 完整性签名（sha256 列表）

set -uo pipefail

LOCAL="${BACKUP_LOCAL:-/var/backups/resume-app}"
REMOTE_NAME="${RCLONE_REMOTE_NAME:-}"     # 必须显式配；不静默 fallback
REMOTE_PATH="${RCLONE_REMOTE_PATH:-resume-app-backups}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"
LOG="/var/log/resume-app-backup-remote.log"

T() { date -Iseconds; }
log_line() { echo "[$(T)] $*" >> "$LOG"; }

if [ -z "$REMOTE_NAME" ]; then
  log_line "ABORT: RCLONE_REMOTE_NAME 未设;请先在 ~/.config/rclone/rclone.conf 配置 remote"
  exit 1
fi

if ! command -v rclone >/dev/null 2>&1; then
  log_line "ABORT: rclone 未装; sudo apt install rclone 或 curl https://rclone.org/install.sh | bash"
  exit 1
fi

if [ ! -d "$LOCAL" ]; then
  log_line "ABORT: local backup dir 不存在 $LOCAL"
  exit 1
fi

# 1. 找今天 + 昨天的 backup（保证至少今天 + 一份冗余）
NOW=$(date +%Y%m%d-%H%M%S)
LATEST=$(ls -1t "$LOCAL"/*.sql.gz 2>/dev/null | head -1)
if [ -z "$LATEST" ]; then
  log_line "ABORT: no local backups in $LOCAL"
  exit 2
fi

# 2. copy 最新一份 + 当天所有 backup
log_line "step 1: copy latest $LATEST to $REMOTE_NAME:$REMOTE_PATH/"
rclone copy "$LATEST" "$REMOTE_NAME:$REMOTE_PATH/latest/" \
  --progress --log-level=WARNING --stats=10s --stats-one-line \
  --retries=3 --low-level-retries=5 --timeout=300s 2>>"$LOG" || {
  log_line "FAIL copy latest"
  exit 3
}

# 3. 把所有 ≤7 天的 backup 同步到 daily/ 远端子目录
log_line "step 2: sync daily backups (last 7 days)"
SEVEN_DAYS_AGO=$(date -d '7 days ago' +%Y%m%d 2>/dev/null || date -v-7d +%Y%m%d)
rclone copy "$LOCAL" "$REMOTE_NAME:$REMOTE_PATH/daily/" \
  --max-age 7d \
  --include "resume-app-*.sql.gz" \
  --progress --log-level=WARNING \
  --retries=3 --timeout=600s 2>>"$LOG" || {
  log_line "FAIL copy daily"
  exit 4
}

# 4. 远端清理过期（> RETAIN_DAYS）
log_line "step 3: delete remote files older than ${RETAIN_DAYS}d"
rclone delete "$REMOTE_NAME:$REMOTE_PATH/" \
  --min-age "${RETAIN_DAYS}d" \
  --include "resume-app-*.sql.gz" \
  --log-level=WARNING 2>>"$LOG" || {
  log_line "WARN delete stale (non-fatal, will retry next run)"
}

# 5. 远端 quota check（optional）
USED=$(rclone about "$REMOTE_NAME:" --json 2>/dev/null | jq -r '.used // empty' || echo "")
if [ -n "$USED" ]; then
  log_line "remote $REMOTE_NAME used=$USED bytes"
fi

log_line "OK remote backup complete"
exit 0
