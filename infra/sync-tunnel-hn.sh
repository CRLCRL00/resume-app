#!/bin/bash
# R59: serveo tunnel hostname sync
#
# 背景 (R55-R56): serveo 匿名用户 SSH tunnel 每 1-2 min 自动 timeout;
# ssh 重启后拿到新的 HN (e.g. 23a18edcbfa51a5e-43-139-176-199.serveousercontent.com).
# R56 改 openapi.js 用 <tunnel-host>.serveousercontent.com placeholder, 但
# Swagger UI 仍看不到 current HN.
#
# 本脚本 (R59):
#   1. 从 systemd journal (resume-app-tunnel.service) 抓最近一次 HN
#   2. 写到 /var/lib/resume-app/serveo.hostname
#   3. backend/src/routes/openapi.js 在每次 /api/docs/openapi.json 请求时
#      读这个文件, 动态覆盖 servers[0].url — 无需 backend 重启
#
# Cron: 每 5 分钟一次 (tunnel ~1-2 min timeout, 5 min 内总能 catch 新 HN)
#
# 用法:
#   sudo cp infra/sync-tunnel-hn.sh /usr/local/bin/sync-tunnel-hn.sh
#   sudo chmod +x /usr/local/bin/sync-tunnel-hn.sh
#   sudo cp infra/serveo-hn-sync.cron /etc/cron.d/serveo-hn-sync
#   sudo systemctl reload cron
#
# Env (optional):
#   SERVEEO_HN_FILE  default: /var/lib/resume-app/serveo.hostname
#   SERVEEO_LOG_FILE default: /var/log/resume-app-serveo-hn-sync.log
#   SERVEEO_JOURNAL_LINES  default: 500  (看多少行 journal 找 HN)
#   SERVEEO_UNIT    default: resume-app-tunnel.service

set -uo pipefail

STATE_FILE="${SERVEEO_HN_FILE:-/var/lib/resume-app/serveo.hostname}"
LOG_FILE="${SERVEEO_LOG_FILE:-/var/log/resume-app-serveo-hn-sync.log}"
JOURNAL_LINES="${SERVEEO_JOURNAL_LINES:-500}"
UNIT="${SERVEEO_UNIT:-resume-app-tunnel.service}"

T() { date -Iseconds; }
log_line() {
  if [ -w "$LOG_FILE" ] || ([ ! -e "$LOG_FILE" ] && [ -w "$(dirname "$LOG_FILE")" ]); then
    echo "[$(T)] $*" >> "$LOG_FILE"
  fi
}

# 1. 抓最近 HN (倒序找第一个匹配的)
# journal: 类似 "Forwarding HTTP traffic from https://23a18edcbfa51a5e-43-139-176-199.serveousercontent.com"
HN_RAW=$(journalctl -u "$UNIT" -n "$JOURNAL_LINES" --no-pager 2>/dev/null \
  | grep -oE '[a-f0-9]{16}-43-139-176-199\.serveousercontent\.com' \
  | tail -1 || true)

if [ -z "$HN_RAW" ]; then
  log_line "WARN: no HN found in journalctl -u $UNIT -n $JOURNAL_LINES (tunnel may be down)"
  exit 1
fi

# 2. 校验格式 (defense in depth)
if ! [[ "$HN_RAW" =~ ^[a-f0-9]{16}-43-139-176-199\.serveousercontent\.com$ ]]; then
  log_line "ERROR: extracted HN does not match expected pattern: $HN_RAW"
  exit 2
fi

# 3. 写到 state file (新文件则创建, 旧文件则比较)
mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null || true

PREV_HN=""
if [ -f "$STATE_FILE" ]; then
  PREV_HN=$(head -1 "$STATE_FILE" 2>/dev/null | tr -d '[:space:]' || true)
fi

if [ "$HN_RAW" = "$PREV_HN" ]; then
  # 没变 → 不写 (保留 mtime, openapi mtime cache 命中)
  exit 0
fi

echo "$HN_RAW" > "$STATE_FILE"
chmod 644 "$STATE_FILE" 2>/dev/null || true

log_line "synced: $PREV_HN -> $HN_RAW"
echo "SERVEEO_HN_CHANGED: $HN_RAW"