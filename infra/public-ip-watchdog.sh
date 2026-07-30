#!/bin/bash
# R53: server-side public IP watchdog
#
# 背景 (R52 root cause):
#   wechat MP 后台 IP 白名单以 server 公网出网 IP 锁定. 但云上 NAT 上游 IP
#   经常漂移 (server 重启 / ISP 换线), wechat 会立即 reject.
#   R27 加的 14.154.95.254 在 R49 server IP 已变 43.139.176.199, 你必须手动
#   上 mp.weixin.qq.com 加新 IP 才能继续.
#
# 解决: 启动 + 每 6 小时探测一次 (curl 2 出口 IP 服务做 quorum), 写
#   /var/lib/resume-app/public_ip.txt. IP 变:
#     - stderr /var/log 告警 ('alert: server public IP drift detected')
#     - devlog-line (git-style) 提示需要手动加 IP
#     - 可选: emit prom metric `server_public_ip_changed_total` 让 prom alerter
#
# 不 auto push mp.weixin.qq.com API (那是 UI 步骤, 我们不能 script):
#   - 添加白名单仅在 mp.weixin.qq.com 后台手动
#   - 这脚本减少 "没发现 IP 变了" 的盲点, **不** 减少手动步骤
#
# 用法:
#   sudo install /opt/resume-app/infra/public-ip-watchdog.sh /usr/local/bin/
#   sudo cp infra/public-ip-watchdog.cron /etc/cron.d/public-ip-watchdog
#
# Env (optional):
#   IP_PROBE_URL_A   default: https://ifconfig.me
#   IP_PROBE_URL_B   default: https://api.ipify.org
#   IP_STATE_FILE    default: /var/lib/resume-app/public_ip.txt
#   IP_LOG_FILE      default: /var/log/resume-app-public-ip.log

set -uo pipefail

PROBE_A="${IP_PROBE_URL_A:-https://ifconfig.me}"
PROBE_B="${IP_PROBE_URL_B:-https://api.ipify.org}"
STATE_FILE="${IP_STATE_FILE:-/var/lib/resume-app/public_ip.txt}"
LOG_FILE="${IP_LOG_FILE:-/var/log/resume-app-public-ip.log}"

# Probe both sources, accept if same
PROBE_TIMEOUT=10
IP_A=$(curl -sk -m "$PROBE_TIMEOUT" "$PROBE_A" 2>/dev/null | tr -d '[:space:]' || echo "")
IP_B=$(curl -sk -m "$PROBE_TIMEOUT" "$PROBE_B" 2>/dev/null | tr -d '[:space:]' || echo "")

# IPv4 only valid; reject empty / non-numeric-dot
is_valid_ipv4() {
  local ip="$1"
  [[ "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]
}

# Select the IP that both probes agree on; fall back to whichever worked
if is_valid_ipv4 "$IP_A" && [ "$IP_A" = "$IP_B" ]; then
  CURRENT_IP="$IP_A"
elif is_valid_ipv4 "$IP_A"; then
  CURRENT_IP="$IP_A"
elif is_valid_ipv4 "$IP_B"; then
  CURRENT_IP="$IP_B"
else
  echo "[$(date -Iseconds)] probe failed: A=$IP_A B=$IP_B" >> "$LOG_FILE"
  exit 1
fi

mkdir -p "$(dirname "$STATE_FILE")"

# Compare to last known
LAST_IP=""
if [ -f "$STATE_FILE" ]; then
  LAST_IP=$(head -1 "$STATE_FILE" 2>/dev/null | tr -d '[:space:]')
fi

if [ "$CURRENT_IP" = "$LAST_IP" ]; then
  exit 0
fi

# IP changed (or first probe)
echo "$CURRENT_IP" > "$STATE_FILE"
chmod 644 "$STATE_FILE"

if [ -z "$LAST_IP" ]; then
  echo "[$(date -Iseconds)] first probe: $CURRENT_IP" >> "$LOG_FILE"
else
  cat <<EOF >> "$LOG_FILE"
[$(date -Iseconds)] ALERT: server public IP drift detected
  previous: $LAST_IP
  current:  $CURRENT_IP
  ---
  ACTION REQUIRED:
    1. Open https://mp.weixin.qq.com → 开发管理 → 开发设置 → IP 白名单
    2. Add new IP '$CURRENT_IP' alongside existing '$LAST_IP'
    3. Both 开发者ID IP 白名单 + 小程序代码上传 IP 白名单
    4. Save; cache takes 5-30 minutes
  -- run: bash infra/public-ip-watchdog.sh after edit
EOF
fi

# Optional: alert via logger (compatible with pino)
echo "ALERT: server-public-ip-changed from=$LAST_IP to=$CURRENT_IP"
