#!/usr/bin/env bash
set -euo pipefail
# 用法：bash scripts/deploy.sh <tarball-path>
# 假设 cwd = /opt/resume-app 或 ENV DEPLOY_ROOT 指向 backend 根
#
# R41-Gap-3: 部署后健康探测 — 连续 N 次失败则自动回滚到上一版
# 健康用 /api/health/ready（DB+Redis 全 OK 才 200；/api/health 仅是进程在）
#
# 配置:
#   DEPLOY_HEALTH_PROBE_TIMEOUT=30   探测总超时（秒）
#   DEPLOY_HEALTH_PROBE_INTERVAL=2   探测间隔（秒）
#   DEPLOY_HEALTH_FAIL_THRESHOLD=5   连续失败多少次触发 rollback
#   DEPLOY_HEALTH_URL=...             探测 URL（默认 http://127.0.0.1:3000/api/health/ready）
#   DEPLOY_SKIP_ROLLBACK=true        禁用自动 rollback（仅人工 verify 时用）
#
# 退出码:
#   0 = 健康探测通过
#   10 = 部署成功但健康持续失败 → 已 rollback
#   11 = rollback 本身失败（最坏情况，需人工介入）

TARBALL="${1:-${DEPLOY_TARBALL:-/tmp/resume-app-backend.tar.gz}}"
ROOT="${DEPLOY_ROOT:-/opt/resume-app}"
cd "$ROOT"

TS=$(date +%s)
BACKUP_DIR=".deploy-backup/$TS"
mkdir -p "$BACKUP_DIR"

HEALTH_PROBE_TIMEOUT="${DEPLOY_HEALTH_PROBE_TIMEOUT:-30}"
HEALTH_INTERVAL="${DEPLOY_HEALTH_PROBE_INTERVAL:-2}"
HEALTH_FAIL_THRESHOLD="${DEPLOY_HEALTH_FAIL_THRESHOLD:-5}"
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:3000/api/health/ready}"
SKIP_ROLLBACK="${DEPLOY_SKIP_ROLLBACK:-false}"

echo "[deploy] root=$ROOT tarball=$TARBALL ts=$TS"
echo "[deploy] health probe: url=$HEALTH_URL timeout=${HEALTH_PROBE_TIMEOUT}s interval=${HEALTH_INTERVAL}s fail_threshold=${HEALTH_FAIL_THRESHOLD}"

# 1. 备份将被覆盖的文件
for f in package.json scripts src; do
  if [ -e "$f" ]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$f")"
    cp -pR "$f" "$BACKUP_DIR/$f" 2>/dev/null || true
  fi
done

# 2. 解压 tarball（只覆盖 backend 内容）
tar xzf "$TARBALL" -C "$ROOT" --strip-components=0
echo "[deploy] files updated"

# 3. npm install（仅 prod deps；package.json 可能已变）
if [ -f package.json ]; then
  echo "[deploy] npm ci --omit=dev"
  npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -5 || npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5
fi

# 4. pm2 reload
if command -v pm2 >/dev/null 2>&1; then
  PM2_NAME="${PM2_NAME:-resume-app-backend}"
  if pm2 show "$PM2_NAME" >/dev/null 2>&1; then
    pm2 reload "$PM2_NAME" 2>&1 | tail -3 || pm2 restart "$PM2_NAME" 2>&1 | tail -3
    echo "[deploy] pm2 reloaded: $PM2_NAME"
  else
    echo "[deploy] WARN: pm2 process $PM2_NAME not found"
  fi
else
  echo "[deploy] WARN: pm2 not in PATH"
fi

# 5. R41-Gap-3: 健康探测 — /api/health/ready 持续 N 次失败则自动 rollback
echo "[deploy] waiting for ready..."
END=$(( $(date +%s) + HEALTH_PROBE_TIMEOUT ))
FAILS=0
LAST_CODE=000
while [ "$(date +%s)" -lt "$END" ]; do
  CODE=$(curl -sS -m 3 -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo "000")
  LAST_CODE=$CODE
  if [ "$CODE" = "200" ]; then
    echo "[deploy] /api/health/ready => 200 (took ~$((HEALTH_PROBE_TIMEOUT - (END - $(date +%s))))s)"
    HEALTH_OK=1
    break
  fi
  FAILS=$((FAILS + 1))
  echo "[deploy] probe $FAILS: $CODE"
  if [ "$FAILS" -ge "$HEALTH_FAIL_THRESHOLD" ]; then
    echo "[deploy] HEALTH FAIL: ${FAILS} consecutive non-200, breakeing loop early"
    break
  fi
  sleep "$HEALTH_INTERVAL"
done

# 探测结果判定
if [ "${HEALTH_OK:-0}" = "1" ]; then
  echo "[deploy] HEALTH OK"
else
  echo "[deploy] HEALTH FAILED (last=$LAST_CODE fails=$FAILS threshold=$HEALTH_FAIL_THRESHOLD)"
  if [ "$SKIP_ROLLBACK" = "true" ]; then
    echo "[deploy] DEPLOY_SKIP_ROLLBACK=true, NOT rolling back. Exiting 11."
    exit 11
  fi
  echo "[deploy] starting auto-rollback to previous backup..."
  # 找最近的非当前 backup
  PREV=$(ls -dt .deploy-backup/* 2>/dev/null | grep -v "^${BACKUP_DIR}\$" | head -1 || true)
  if [ -z "$PREV" ]; then
    echo "[deploy] ROLLBACK FAILED: no previous backup found"
    exit 11
  fi
  echo "[deploy] rolling back to: $PREV"
  # 恢复 backup 内容
  for f in package.json scripts src; do
    if [ -e "$PREV/$f" ]; then
      cp -pR "$PREV/$f" "./$f" 2>/dev/null || true
    fi
  done
  # 重装依赖（如 package.json 有变）
  if [ -f package.json ]; then
    npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -3 || true
  fi
  # 重启 + 短暂等
  if command -v pm2 >/dev/null 2>&1 && pm2 show "$PM2_NAME" >/dev/null 2>&1; then
    pm2 reload "$PM2_NAME" 2>&1 | tail -3 || pm2 restart "$PM2_NAME" 2>&1 | tail -3
  fi
  sleep 3
  ROLLBACK_CODE=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo "000")
  if [ "$ROLLBACK_CODE" = "200" ]; then
    echo "[deploy] ROLLBACK OK (restored from $PREV)"
  else
    echo "[deploy] ROLLBACK STILL FAILING (code=$ROLLBACK_CODE). MANUAL INTERVENTION REQUIRED."
  fi
  exit 10
fi

# 6. 清理过期备份（保留最近 5 个）
cd "$ROOT"
ls -dt .deploy-backup/* 2>/dev/null | tail -n +6 | xargs -r rm -rf
echo "[deploy] done. backup=$BACKUP_DIR"
