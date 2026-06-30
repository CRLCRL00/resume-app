#!/bin/bash
# smoke-load.sh — quick load check: 20 concurrent × 5s, hits /api/health
# 烟测级（不是真实 k6/wrk）：足够 sanity check 基础承载
# CI 可调；本地 + 监控后跑也安全

set -uo pipefail

BASE_URL="${BASE_URL:-https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com}"
CONCURRENCY=20
DURATION_S=5
LOG="${LOG:-/var/log/resume-app-load.log}"

# 日志目录可写才写（dev local 可能没 /var/log）
LOG_ENABLED=1
if ! touch "$LOG" 2>/dev/null; then LOG_ENABLED=0; fi

TS() { date -Iseconds; }
LOG_LINE() { [ "$LOG_ENABLED" -eq 1 ] && echo "$1" >> "$LOG" || true; }

LOG_LINE "[$(TS)] load smoke start: $CONCURRENCY concurrent, ${DURATION_S}s target=$BASE_URL/api/health"

# 并发压测 /api/health 5s：后台 curl 进程 × CONCURRENCY × duration
END_TS=$(( $(date +%s) + DURATION_S ))
PIDS=()
for i in $(seq 1 $CONCURRENCY); do
  while [ $(date +%s) -lt $END_TS ]; do
    curl -sk -o /dev/null -w '%{http_code} %{time_total}\n' "$BASE_URL/api/health"
    sleep 0.05
  done > /tmp/load-$i.txt 2>&1 &
  PIDS+=($!)
done

wait "${PIDS[@]}"

# 合并结果统计
COUNT=0
SUCC=0
TOTAL_TIME=0
MAX_TIME=0
for i in $(seq 1 $CONCURRENCY); do
  if [ -f /tmp/load-$i.txt ]; then
    while read -r line; do
      COUNT=$((COUNT+1))
      code=$(echo "$line" | awk '{print $1}')
      t=$(echo "$line" | awk '{print $2}')
      [ "$code" = "200" ] && SUCC=$((SUCC+1))
      if [ -n "$t" ]; then
        ms=$(awk "BEGIN {print int($t*1000)}")
        TOTAL_TIME=$((TOTAL_TIME + ms))
        [ "$ms" -gt "$MAX_TIME" ] && MAX_TIME=$ms
      fi
    done < /tmp/load-$i.txt
    rm /tmp/load-$i.txt
  fi
done

if [ "$COUNT" -gt 0 ]; then
  AVG=$((TOTAL_TIME / COUNT))
  LINE="[$(TS)] load smoke done: $SUCC/$COUNT 200 OK, avg ${AVG}ms, max ${MAX_TIME}ms"
  LOG_LINE "$LINE"
  echo "$LINE" | sed 's/^\[[^]]*\] //'
fi
