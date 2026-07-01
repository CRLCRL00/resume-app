#!/bin/bash
# monitor.sh — every 5 min checks /api/health/deep + failure alerts.
# alerts sent via:
#   - file: /var/log/resume-app-monitor.log (always)
#   - webhook: optional (env HEALTH_WEBHOOK url) — POST JSON
#
# install cron:
#   echo '*/5 * * * * root /usr/local/bin/monitor-resume-app.sh' > /etc/cron.d/resume-app-monitor
#   ln -sf /opt/resume-app/backend/scripts/monitor.sh /usr/local/bin/monitor-resume-app.sh

set -uo pipefail

URL="${HEALTH_URL:-https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com/api/health/deep}"
ALERT_URL="${HEALTH_WEBHOOK:-https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com/api/internal/alert}"
ALERT_TOKEN="${ALERT_TOKEN:-dev-alert-token-change-me}"
LOG="/var/log/resume-app-monitor.log"
TIMEOUT=10
STATE_FILE="/var/run/resume-app-monitor-state"

TS() { date -Iseconds; }
LOG_TS=$(TS)

# Probe
HTTP=$(curl -sk -m "$TIMEOUT" -o /tmp/health.json -w '%{http_code}' "$URL" 2>/dev/null || echo "000")

if [ "$HTTP" = "200" ]; then
  # All OK
  echo "[$LOG_TS] OK $HTTP" >> "$LOG"
  rm -f "$STATE_FILE"
  exit 0
fi

# Degraded/down — check if last state was already flagged (avoid spam)
if [ -f "$STATE_FILE" ]; then
  echo "[$LOG_TS] still bad (last flagged $(cat $STATE_FILE)), HTTP=$HTTP, suppressing" >> "$LOG"
  exit 1
fi

# First time flagged
echo "[$LOG_TS] FAIL HTTP=$HTTP body=$(head -c 200 /tmp/health.json)" >> "$LOG"
echo "$(TS)" > "$STATE_FILE"

# Optional webhook — HMAC-SHA256 签 (防重放/伪造) + retry x3
if [ -n "${HEALTH_WEBHOOK:-}" ]; then
  PAYLOAD=$(cat <<JSON
{"timestamp":"$LOG_TS","url":"$URL","http":$HTTP,"body":$(head -c 500 /tmp/health.json | jq -Rs .)}
JSON
)
  TS_MS=$(date +%s%3N)
  SIG=$(printf "%s" "$PAYLOAD$TS_MS" | openssl dgst -sha256 -hmac "$ALERT_TOKEN" | sed 's/^.* //')
  # retry x3 with backoff (2s, 4s)
  for attempt in 1 2 3; do
    HTTP_C=$(curl -m 5 -s -o /dev/null -w '%{http_code}' -X POST "$HEALTH_WEBHOOK" \
      -H 'Content-Type: application/json' \
      -H "X-Alert-Token: $ALERT_TOKEN" \
      -H "X-Alert-Timestamp: $TS_MS" \
      -H "X-Alert-Signature: sha256=$SIG" \
      -d "$PAYLOAD" 2>/dev/null || echo "000")
    if [ "$HTTP_C" = "200" ]; then
      echo "[$(TS)] webhook attempt $attempt OK ($HTTP_C)" >> "$LOG"
      break
    fi
    echo "[$(TS)] webhook attempt $attempt fail ($HTTP_C)" >> "$LOG"
    [ "$attempt" -eq 3 ] && break
    sleep $((attempt * 2))
  done
fi

# Console hints
echo "  → fix: ssh ubuntu@43.139.176.199; pm2 logs resume-app-backend; ls /var/backups/resume-app/"
exit 1
