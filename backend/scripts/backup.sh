#!/bin/bash
# backup.sh — daily mysqldump to /var/backups, retain 7 days, log to /var/log/backup.log
# Runs via cron at 03:00 daily.
# Reads DB_PASSWORD from /opt/resume-app/backend/.env (DB_PASSWORD line).
set -euo pipefail

BACKUP_DIR="/var/backups/resume-app"
LOG="/var/log/resume-app-backup.log"
RETAIN_DAYS=7
TS=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/resume-app-$TS.sql.gz"

# 读 DB_PASSWORD from env file (avoid hardcoding in repo source)
ENV_FILE="/opt/resume-app/backend/.env"
if [ -r "$ENV_FILE" ]; then
  DB_PASSWORD=$(grep '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2- || echo "")
fi
if [ -z "${DB_PASSWORD:-}" ]; then
  echo "[$(date -Iseconds)] backup FAILED: DB_PASSWORD not set / env file unreadable" >> "$LOG"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
echo "[$(date -Iseconds)] backup start -> $OUT" >> "$LOG"

mysqldump \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --default-character-set=utf8mb4 \
  -u resume_app_user \
  -p"$DB_PASSWORD" \
  resume_app \
  | gzip -9 > "$OUT"

SIZE=$(stat -c %s "$OUT")
echo "[$(date -Iseconds)] backup done  -> $OUT ($SIZE bytes)" >> "$LOG"

# 清理 N 天前旧备份
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +${RETAIN_DAYS} -delete

echo "[$(date -Iseconds)] cleanup done (retention $RETAIN_DAYS days)" >> "$LOG"
