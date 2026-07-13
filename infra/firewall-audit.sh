#!/bin/bash
# R41-Gap-20: firewall audit — 列出监听端口 + ufw 规则 + 该关的端口建议
#
# 用法：bash infra/firewall-audit.sh   （server 上本地跑）
# 输出：
#   - 监听端口（ss -tlnp）
#   - ufw 状态和规则（如已装）
#   - iptables 概要（如未装 ufw）
#   - 期望/实际对比表
#
# 退出码：
#   0 = 合规
#   1 = 警告（多余端口暴露）
#   2 = 严重（关键服务对外暴露）

set -uo pipefail

EXPECTED_TCP_PUBLIC="22 80 443"   # SSH + HTTP + HTTPS（公网可达）
EXPECTED_TCP_PRIVATE="3003"        # backend，nginx 反代，不该对外
DB_PORT_DEFAULT=3306
REDIS_PORT_DEFAULT=6379

echo "=== Firewall Audit — $(hostname) @ $(date -Iseconds) ==="
echo

# 1. ufw
echo "## ufw status"
if command -v ufw >/dev/null 2>&1; then
  ufw status verbose || true
  echo
else
  echo "ufw not installed"
  echo
fi

# 2. iptables summary
echo "## iptables INPUT rules (allow tcp)"
if command -v iptables >/dev/null 2>&1; then
  iptables -L INPUT -n --line-numbers 2>/dev/null | head -30 || true
  echo
else
  echo "iptables not available"
  echo
fi

# 3. 监听端口
echo "## Listening TCP ports"
ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "(neither ss nor netstat)"
echo

# 4. 期望对比
echo "## Expectation Check"
LISTEN=$(ss -tln 2>/dev/null | awk 'NR>1 {gsub(/.*:/,"",$4); print $4}' | sort -u || true)
SEVERITY=0
WARNINGS=""

for port in $LISTEN; do
  in_expected_private="no"
  in_expected_public="no"
  case " $EXPECTED_TCP_PUBLIC " in *" $port "*) in_expected_public="yes" ;; esac
  case " $EXPECTED_TCP_PRIVATE " in *" $port "*) in_expected_private="yes" ;; esac

  # DB / Redis 不应出现在公网监听
  if [ "$port" = "$DB_PORT_DEFAULT" ] || [ "$port" = "$REDIS_PORT_DEFAULT" ]; then
    ADDR=$(ss -tln 2>/dev/null | awk -v p=":$port" '$4 ~ p {print $4; exit}')
    case "$ADDR" in
      *127.0.0.1:*|*\[::1\]:*) echo "OK   :$port bound to localhost only" ;;
      *0.0.0.0:*|*\[::\]:*)
        echo "FAIL :$port bound to 0.0.0.0 — DB/Redis MUST be localhost-only"
        SEVERITY=2
        WARNINGS="$WARNINGS
- port $port (DB/Redis?) bound to 0.0.0.0 → add 'bind-address = 127.0.0.1' in my.cnf / redis.conf"
        ;;
      *) echo "WARN :$port bound to $ADDR (not 0.0.0.0 nor 127.0.0.1)" ;;
    esac
    continue
  fi

  if [ "$in_expected_public" = "yes" ]; then
    echo "OK   :$port (expected public)"
  elif [ "$in_expected_private" = "yes" ]; then
    ADDR=$(ss -tln 2>/dev/null | awk -v p=":$port" '$4 ~ p {print $4; exit}')
    case "$ADDR" in
      *127.0.0.1:*|*\[::1\]:*) echo "OK   :$port bound to localhost (behind nginx)" ;;
      *)
        echo "WARN :$port expected private but listening on $ADDR"
        SEVERITY=$((SEVERITY > 1 ? SEVERITY : 1))
        WARNINGS="$WARNINGS
- port $port listening on $ADDR, expected 127.0.0.1; put behind nginx"
        ;;
    esac
  else
    echo "INFO :$port (not in expected list — verify)"
    SEVERITY=$((SEVERITY > 0 ? SEVERITY : 1))
  fi
done

# 5. reverse tunnel (serveo)
echo
echo "## SSH tunnel processes"
pgrep -af 'ssh.*serveo' 2>/dev/null | head -3 || echo "(none)"

# 6. summary
echo
echo "=== Summary: severity=$SEVERITY ==="
if [ "$SEVERITY" -ge 2 ]; then
  echo "CRITICAL — 立即修复 DB/Redis 暴露:"
  echo -n "$WARNINGS"
  exit 2
elif [ "$SEVERITY" -ge 1 ]; then
  echo "WARN — 端口对齐待做:"
  echo -n "$WARNINGS"
  exit 1
fi
echo "OK"
exit 0
