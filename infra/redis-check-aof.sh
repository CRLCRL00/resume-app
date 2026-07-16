#!/usr/bin/env bash
# R90-B: Verify Redis has AOF persistence enabled.
#
# Why: Replay buffer + event id counter (R84+R85) live in Redis. Without
# persistence, a Redis crash loses all SSE resume state. AOF (Append Only File)
# survives `redis-cli SHUTDOWN` and most crashes (with appendfsync=everysec).
#
# Run on server: `bash infra/redis-check-aof.sh`
#
# Exit codes:
#   0 — AOF enabled (appendonly=yes) and reachable
#   1 — Redis not reachable
#   2 — AOF disabled (warn loud)
set -euo pipefail

REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"

echo "== Redis AOF check =="
echo "host: ${REDIS_HOST}:${REDIS_PORT}"

if ! redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping >/dev/null 2>&1; then
  echo "❌ Redis not reachable"
  exit 1
fi

APPENDONLY=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" config get appendonly | tail -1)
APPEND_FSYNC=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" config get appendfsync | tail -1)
AOF_FILE=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" config get appendfilename | tail -1)
AOF_DIR=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" config get dir | tail -1)
AOF_SIZE=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" info persistence | grep aof_current_size | cut -d: -f2 | tr -d '\r' || echo "0")

echo "appendonly:       ${APPENDONLY}"
echo "appendfsync:      ${APPEND_FSYNC}"
echo "appendfilename:   ${AOF_FILE}"
echo "dir:              ${AOF_DIR}"
echo "aof_current_size: ${AOF_SIZE} bytes"
echo ""

if [ "$APPENDONLY" = "yes" ]; then
  echo "✅ AOF enabled"
  # Check SSE buffer durability
  BUF_KEYS=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" --scan --pattern 'sse:*' | wc -l)
  echo "SSE keys present: ${BUF_KEYS}"
  if [ "$BUF_KEYS" -gt 0 ]; then
    for k in $(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" --scan --pattern 'sse:*'); do
      ttl=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ttl "$k")
      type=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" type "$k")
      echo "  ${k}: type=${type} ttl=${ttl}s"
    done
  fi
  exit 0
else
  echo "❌ AOF disabled — replay buffer + event id lost on Redis crash"
  echo "   Enable: redis-cli config set appendonly yes"
  echo "   Or edit /etc/redis/redis.conf: appendonly yes"
  exit 2
fi