#!/bin/bash
# verify-backup.sh — run after backup.sh, sanity-check latest backup
set -uo pipefail

BACKUP_DIR="/var/backups/resume-app"
LOG="/var/log/resume-app-backup-verify.log"

TS() { date -Iseconds; }

# Find latest backup
LATEST=$(ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -1)

if [ -z "$LATEST" ]; then
  echo "[$(TS)] FAIL: no backups in $BACKUP_DIR" >> "$LOG"
  exit 1
fi

SIZE=$(stat -c %s "$LATEST")
if [ "$SIZE" -lt 1024 ]; then
  echo "[$(TS)] FAIL: $LATEST only ${SIZE} bytes (< 1KB)" >> "$LOG"
  exit 2
fi

# Verify contents: must have CREATE TABLE statements
TABLES=$(zcat "$LATEST" 2>/dev/null | grep -c "^CREATE TABLE")
if [ "$TABLES" -lt 5 ]; then
  echo "[$(TS)] FAIL: $LATEST has only $TABLES CREATE TABLE (<5)" >> "$LOG"
  exit 3
fi

# Verify decompresses cleanly
zcat "$LATEST" > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "[$(TS)] FAIL: $LATEST corrupt (zcat error)" >> "$LOG"
  exit 4
fi

echo "[$(TS)] OK: $LATEST ${SIZE}B, $TABLES tables" >> "$LOG"
exit 0
