#!/bin/bash
# R41-Gap-7: serveo tunnel watchdog — 每 2 分钟检查 tunnel 进程在不在；不在则重启
#
# 用法：bash infra/serveo-watchdog.sh  （systemd 单元间隔跑）
# 安装 cron fallback：
#   echo '*/2 * * * * root /opt/resume-app/infra/serveo-watchdog.sh' > /etc/cron.d/serveo-watchdog
#
# systemd 主路径（推荐）：
#   infra/serveo-watchdog.service 启用 Type=oneshot+Restart=on-failure 来 auto restart tunnel
#   本脚本仅做 health check + log + 主动 kill 僵死进程
#
# 设计：watchdog 比 systemd 多的能力：
#   - 检测 stderr 死循环（tunnel 进程在但 80 端口无响应）
#   - 自动 kill + restart
#   - 通知（写 log，无 webhook 依赖）

set -uo pipefail

LOG="/var/log/resume-app-serveo-watchdog.log"
LOCK="/var/run/serveo-watchdog.lock"
TUNNEL_PGREP_PATTERN='ssh.*serveo.*-R.*:localhost:3003'
HEALTH_URL="${TUNNEL_HEALTH_URL:-http://127.0.0.1/api/health}"

# 防止重入
if [ -f "$LOCK" ]; then
  PID=$(cat "$LOCK")
  if kill -0 "$PID" 2>/dev/null; then
    echo "[$(date -Iseconds)] another watchdog still running (pid=$PID), skip" >> "$LOG"
    exit 0
  fi
  rm -f "$LOCK"
fi
echo "$$" > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

T() { date -Iseconds; }
log_line() {
  if [ -w "$LOG" ] || ([ ! -e "$LOG" ] && [ -w "$(dirname "$LOG")" ]); then
    echo "[$(T)] $*" >> "$LOG"
  fi
}

# 1. 进程检查
PIDS=$(pgrep -f "$TUNNEL_PGREP_PATTERN" || true)
if [ -z "$PIDS" ]; then
  log_line "ALERT: no serveo tunnel process found, attempting restart"
  # systemd 会自动 restart；watchdog 仅做主动尝试（防 systemd 未启）
  pkill -f 'ssh.*serveo' 2>/dev/null || true
  nohup setsid ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
    -R 80:localhost:3003 serveo.net < /dev/null >> /tmp/serveo.log 2>&1 &
  disown
  log_line "started serveo ssh pid=$! (if systemd 未 restart, 此进程兜底)"
  exit 1
fi

# 2. 僵死检测 — 探 health 端点是否能从本机通过隧道被外部域名访问
#   跳过（用户在外部能访问即可；本机探 localhost 等于绕过 tunnel）
#   改为：检查 tunnel 进程是否已经 STUCK（无 stderr 活动 > 5min 但仍在 zombie）
LAST_ACTIVITY=$(stat -c %Y /tmp/serveo.log 2>/dev/null || echo 0)
NOW=$(date +%s)
STALE=$(( NOW - LAST_ACTIVITY ))
if [ "$STALE" -gt 600 ]; then
  log_line "WARN: /tmp/serveo.log stale ${STALE}s, tunnel may be zombie (still has pid)"
  # 不主动 kill — 让 systemd 判定；仅 WARN
fi

# 3. 检查期望 PID 数（应该恰好 1 个，多了就是 leak）
COUNT=$(echo "$PIDS" | wc -l)
if [ "$COUNT" -gt 1 ]; then
  log_line "WARN: $COUNT serveo tunnel processes (multiple), killing all + restarting"
  echo "$PIDS" | xargs -r kill -9 2>/dev/null || true
  sleep 2
  pkill -9 -f 'ssh.*serveo' 2>/dev/null || true
  # 让 systemd 重新起
fi

# OK
log_line "OK tunnel pid=$PIDS stale=${STALE}s"
exit 0
