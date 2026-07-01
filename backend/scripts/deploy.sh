#!/usr/bin/env bash
set -euo pipefail
# 用法：bash scripts/deploy.sh <tarball-path>
# 假设 cwd = /opt/resume-app 或 ENV DEPLOY_ROOT 指向 backend 根
TARBALL="${1:-${DEPLOY_TARBALL:-/tmp/resume-app-backend.tar.gz}}"
ROOT="${DEPLOY_ROOT:-/opt/resume-app}"
cd "$ROOT"

TS=$(date +%s)
BACKUP_DIR=".deploy-backup/$TS"
mkdir -p "$BACKUP_DIR"

echo "[deploy] root=$ROOT tarball=$TARBALL ts=$TS"

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

# 5. smoke
sleep 1
HEALTH_CODE=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health 2>/dev/null || echo "000")
echo "[deploy] /api/health => $HEALTH_CODE"

# 6. 清理过期备份（保留最近 5 个）
cd "$ROOT"
ls -dt .deploy-backup/* 2>/dev/null | tail -n +6 | xargs -r rm -rf
echo "[deploy] done. backup=$BACKUP_DIR"
