#!/usr/bin/env bash
# 等 /api/health/ready 200 才允许 PM2 reload
set -euo pipefail
PORT="${PORT:-3000}"
HOST="${HOST:-127.0.0.1}"
URL="http://${HOST}:${PORT}/api/health/ready"
TIMEOUT="${TIMEOUT:-30}"

echo "[start-prod] waiting for ready at $URL (timeout ${TIMEOUT}s)"
for i in $(seq 1 "$TIMEOUT"); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)
  if [ "$code" = "200" ]; then
    echo "[start-prod] ready after ${i}s"
    exit 0
  fi
  sleep 1
done
echo "[start-prod] NOT READY within ${TIMEOUT}s — failing" >&2
exit 1
