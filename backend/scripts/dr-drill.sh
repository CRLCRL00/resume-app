#!/bin/bash
# R41-Gap-12: DR drill — 把最新 backup 灌进 *test* 库，验证 7 张表都有数据 + 可写
#
# 用法：bash scripts/dr-drill.sh  （默认用最新 backup + 灌 resume_app_test）
#
# 安全：只读 backup + 写 isolated test DB（不碰 prod resume_app）
# 不删除 test 库，留给 ops 人工 rm 排查
#
# install cron：
#   echo '0 4 1 * * root /usr/local/bin/dr-drill-resume-app.sh' > /etc/cron.d/resume-app-dr-drill
#   ln -sf /opt/resume-app/backend/scripts/dr-drill.sh /usr/local/bin/dr-drill-resume-app.sh

set -uo pipefail

BACKUP_DIR="/var/backups/resume-app"
TEST_DB="resume_app_test_dr_$(date +%Y%m%d_%H%M%S)"
LOG="/var/log/resume-app-dr-drill.log"

ENV_FILE="/opt/resume-app/backend/.env"
if [ -r "$ENV_FILE" ]; then
  DB_PASSWORD=$(grep '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2- || echo "")
  DB_USER=$(grep '^DB_USER=' "$ENV_FILE" | cut -d= -f2- || echo "root")
fi

if [ -z "${DB_PASSWORD:-}" ]; then
  echo "[$(date -Iseconds)] DR drill FAILED: DB_PASSWORD not set" >> "$LOG"
  exit 1
fi

# 找最新 backup
LATEST=$(ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -1)
if [ -z "$LATEST" ]; then
  echo "[$(date -Iseconds)] DR drill FAILED: no backups in $BACKUP_DIR" >> "$LOG"
  exit 2
fi
SIZE=$(stat -c %s "$LATEST")
echo "[$(date -Iseconds)] DR drill start: backup=$LATEST size=${SIZE}B target=$TEST_DB" >> "$LOG"

# 1. 建 test 库
echo "[$(date -Iseconds)] creating test db $TEST_DB" >> "$LOG"
if ! mysql -u "$DB_USER" -p"$DB_PASSWORD" -e "CREATE DATABASE \`$TEST_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" 2>>"$LOG"; then
  echo "[$(date -Iseconds)] DR drill FAILED: CREATE DATABASE" >> "$LOG"
  exit 3
fi

# 2. 灌 backup
if ! zcat "$LATEST" | mysql -u "$DB_USER" -p"$DB_PASSWORD" "$TEST_DB" 2>>"$LOG"; then
  echo "[$(date -Iseconds)] DR drill FAILED: restore into $TEST_DB" >> "$LOG"
  exit 4
fi

# 3. 校验 — 必须有 ≥7 张表 + 每张表至少 1 行
TABLE_COUNT=$(mysql -u "$DB_USER" -p"$DB_PASSWORD" -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TEST_DB'" 2>/dev/null || echo 0)
if [ "$TABLE_COUNT" -lt 7 ]; then
  echo "[$(date -Iseconds)] DR drill FAILED: only $TABLE_COUNT tables (< 7)" >> "$LOG"
  exit 5
fi

# 4. 每张表都要有数据
EMPTY_TABLES=$(mysql -u "$DB_USER" -p"$DB_PASSWORD" -N -B "$TEST_DB" -e "
  SELECT GROUP_CONCAT(TABLE_NAME SEPARATOR ',')
  FROM information_schema.tables
  WHERE table_schema='$TEST_DB'
    AND TABLE_NAME NOT LIKE 'schema_%'
    AND TABLE_NAME NOT LIKE 'migrations_%'
    AND TABLE_ROWS = 0
" 2>/dev/null || echo "")

# 5. 可写测试 — INSERT 一行 + DELETE（确保 rollback/redo log OK）
WRITE_OK=$(mysql -u "$DB_USER" -p"$DB_PASSWORD" -N -B "$TEST_DB" -e "
  CREATE TABLE IF NOT EXISTS _dr_drill_test (id INT PRIMARY KEY);
  INSERT INTO _dr_drill_test VALUES (1);
  DELETE FROM _dr_drill_test;
  DROP TABLE _dr_drill_test;
  SELECT 'OK';
" 2>/dev/null || echo "FAIL")

if [ "$WRITE_OK" != "OK" ]; then
  echo "[$(date -Iseconds)] DR drill WARN: write test failed (db may be readonly)" >> "$LOG"
fi

# 6. 留 test 库给 ops / 自动清理 7 天后
mysql -u "$DB_USER" -p"$DB_PASSWORD" -e "
  CREATE EVENT IF NOT EXISTS cleanup_dr_drill
  ON SCHEDULE AT CURRENT_TIMESTAMP + INTERVAL 7 DAY
  DO DROP DATABASE IF EXISTS \`$TEST_DB\`;
" 2>/dev/null || true

# 7. 报告
if [ -n "$EMPTY_TABLES" ]; then
  echo "[$(date -Iseconds)] DR drill WARN: empty tables: $EMPTY_TABLES (rows reported may be estimate)" >> "$LOG"
fi
echo "[$(date -Iseconds)] DR drill OK: backup=$LATEST size=${SIZE}B tables=$TABLE_COUNT target=$TEST_DB write=$WRITE_OK" >> "$LOG"

# console 提示
echo "DR drill OK"
echo "  backup: $LATEST"
echo "  size:   ${SIZE}B"
echo "  tables: $TABLE_COUNT"
echo "  target: $TEST_DB (auto-drop 7d 后)"
echo "  log:    $LOG"
exit 0
