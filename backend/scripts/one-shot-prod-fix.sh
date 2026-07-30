#!/usr/bin/env bash
# one-shot-prod-fix.sh — 一行 ssh 跑完 deploy + migration + smoke + report
#
# 用法 (one-liner, 推荐):
#   ssh ubuntu@43.139.176.199 'bash -s' < backend/scripts/one-shot-prod-fix.sh
#
# 也支持在 server 本地直接跑:
#   bash /opt/resume-app/backend/scripts/one-shot-prod-fix.sh
#
# 退出码:
#   0 = 全过
#   1 = git pull 失败
#   2 = DB backup 失败
#   3 = migration 失败
#   4 = PM2 重启失败
#   5 = smoke 探测有 route 仍 404 (backend 没 reload)
#   6 = schema 不匹配 (migration 没真正应用)

set -uo pipefail

ROOT="${DEPLOY_ROOT:-/opt/resume-app}"
BACKEND="$ROOT/backend"
PASS=0
FAIL=0
RESULTS=()
log() { printf '\033[1;36m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
ok()  { PASS=$((PASS+1)); RESULTS+=("✓ $*"); log "✓ $*"; }
ng()  { FAIL=$((FAIL+1)); RESULTS+=("✗ $*"); log "✗ $*"; }
hdr() { printf '\n\033[1;33m=== %s ===\033[0m\n' "$*"; }

# ============= 1. 环境
hdr "1. 环境检查"
if [[ ! -d "$BACKEND" ]]; then
  ng "backend 不存在: $BACKEND"; exit 1
fi
ok "backend 存在: $BACKEND"

cd "$BACKEND" || { ng "cd 失败"; exit 1; }
GIT_COMMIT_BEFORE=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
ok "当前 commit: $GIT_COMMIT_BEFORE"

# ============= 2. Git pull
hdr "2. Git pull (拉 main 最新代码)"
if git fetch origin main 2>&1 | tail -5; then
  if git merge --ff-only origin/main 2>&1 | tail -3; then
    GIT_COMMIT_AFTER=$(git rev-parse --short HEAD)
    if [[ "$GIT_COMMIT_BEFORE" == "$GIT_COMMIT_AFTER" ]]; then
      ok "本地已最新 ($GIT_COMMIT_AFTER),无需 pull"
    else
      ok "pull 成功: $GIT_COMMIT_BEFORE → $GIT_COMMIT_AFTER"
    fi
  else
    # ff-only 失败可能是有 merge commit / 冲突 → 跳过 pull,直接继续(用现有代码)
    ng "git pull 不是 fast-forward,跳过 (backend 已有 commit)"
  fi
else
  ng "git fetch 失败 - 检查网络/SSH key"
  log "    继续 — 用现有代码试"
fi

# MySQL 凭证 3 级 fallback (user 0 手动):
#   1. $MYSQL_ROOT_PASSWORD env (GH actions 注入 或 console export)
#   2. $HOME/.my.cnf [client] section
#   3. /opt/resume-app/backend/.env 的 DB_PASSWORD 字段 (脚本自动读, 不显示值)
if [[ -z "${MYSQL_ROOT_PASSWORD:-}" ]]; then
  if [ -f "$HOME/.my.cnf" ]; then
    ok "MySQL 凭证来自 ~/.my.cnf"
  elif [ -f "$BACKEND/.env" ]; then
    # 从 .env 读 DB_PASSWORD (静默, 不输出值)
    MYSQL_ROOT_PASSWORD=$(grep -E "^[[:space:]]*DB_PASSWORD[[:space:]]*=" "$BACKEND/.env" 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e "s/^['\"]//" -e "s/['\"]$//")
    if [[ -n "$MYSQL_ROOT_PASSWORD" && "$MYSQL_ROOT_PASSWORD" != "<填数据库密码>" ]]; then
      ok "MySQL 凭证来自 backend/.env (DB_PASSWORD 字段)"
      # 不 export 到子进程环境, 避免 echo 时泄漏; 用变量
    else
      ng "backend/.env 存在但 DB_PASSWORD 未配置"
      exit 2
    fi
  else
    ng "MYSQL_ROOT_PASSWORD 未设置,且 ~/.my.cnf 不存在,backend/.env 不存在"
    exit 2
  fi
fi
mysql_cred_args() {
  if [[ -n "${MYSQL_ROOT_PASSWORD:-}" ]]; then echo "-uroot -p$MYSQL_ROOT_PASSWORD"; else echo ""; fi
}
# Silence: 永远不要 echo MYSQL_ROOT_PASSWORD
trap 'unset MYSQL_ROOT_PASSWORD' EXIT

# ============= 3. DB 备份
hdr "3. DB 备份 (防 migration 翻车)"
BACKUP_FILE="/tmp/before-jobpilot-migration-$(date +%Y%m%d-%H%M%S).sql"
if mysqldump -h 127.0.0.1 $(mysql_cred_args) \
     resume_app > "$BACKUP_FILE" 2>/dev/null; then
  ok "DB 备份: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
else
  ng "DB 备份失败 — 跳过 migration 步骤"
  exit 2
fi

# ============= 4. Migration
hdr "4. Migration (jobpilot.sql 加 jobs/resumes/applications schema)"
MIG="$BACKEND/db/migrations/jobpilot.sql"
if [[ ! -f "$MIG" ]]; then
  ng "migration 文件不存在: $MIG"; exit 3
fi

# 检查 schema 是否已经迁移 (看 story_points 列是否存在)
HAS_STORY_POINTS=$(mysql -h 127.0.0.1 $(mysql_cred_args) \
  resume_app -N -e "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='resume_app' AND table_name='resumes' AND column_name='story_points';" 2>/dev/null || echo 0)

if [[ "$HAS_STORY_POINTS" == "1" ]]; then
  ok "schema 已迁移过 (story_points 列已存在),跳过"
else
  log "应用 migration..."
  if mysql -h 127.0.0.1 $(mysql_cred_args) \
       resume_app < "$MIG" 2>&1 | tail -5; then
    # 重新检查
    NEW_HAS=$(mysql -h 127.0.0.1 $(mysql_cred_args) \
      resume_app -N -e "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='resume_app' AND table_name='resumes' AND column_name='story_points';" 2>/dev/null || echo 0)
    if [[ "$NEW_HAS" == "1" ]]; then
      ok "migration 成功: story_points 列已加"
    else
      ng "migration 后 schema 检查失败"
      exit 6
    fi
  else
    ng "migration 执行失败"
    exit 3
  fi
fi

# 验证 jobpilot_applications 表
HAS_APPS_TABLE=$(mysql -h 127.0.0.1 $(mysql_cred_args) \
  resume_app -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='resume_app' AND table_name='jobpilot_applications';" 2>/dev/null || echo 0)
if [[ "$HAS_APPS_TABLE" == "1" ]]; then
  ok "jobpilot_applications 表已存在"
else
  ng "jobpilot_applications 表不存在 — migration 没运行"
  exit 6
fi

# ============= 5. PM2 重启
hdr "5. PM2 restart"
if pm2 list 2>/dev/null | grep -q "resume-app-backend"; then
  log "重启 PM2 (--update-env 才会加载新 env 变量)..."
  pm2 restart resume-app-backend --update-env 2>&1 | tail -5
  sleep 3
  if pm2 list | grep "resume-app-backend" | grep -q "online"; then
    ok "PM2 resume-app-backend 在线上"
  else
    ng "PM2 重启后不在 online — 看 pm2 logs"
    pm2 logs resume-app-backend --lines 20 --nostream 2>&1 | tail -10
    exit 4
  fi
else
  ng "PM2 没找到 resume-app-backend 进程 — 需手动启动"
  exit 4
fi

# ============= 6. Smoke 探测 (4 个核心 route)
hdr "6. Smoke 探测 (jobpilot 4 个核心 route)"
probe() {
  local path="$1" method="$2" data="${3:-}"
  local args="-sk -o /dev/null -w %{http_code} --max-time 6 -X $method"
  if [[ -n "$data" ]]; then
    args="$args -H Content-Type:application/json -d $data"
  fi
  eval curl "$args" "http://127.0.0.1:3003$path"
}

H1=$(probe "/api/health" "GET")
H2=$(probe "/api/match" "POST" "'{}'")
H3=$(probe "/api/jobpilot/profile-diagnose" "POST" "'{}'")
H4=$(probe "/api/ai/assist-field" "POST" "'{}'")

[[ "$H1" == "200" ]] && ok "/api/health           → $H1 ✅" || ng "/api/health           → $H1 (期望 200)"
# match + jobpilot 没 token 应 401 (路由在); ai/assist-field 没 token 应 401 (路由在)
if [[ "$H2" == "401" ]]; then ok "/api/match            → $H2 ✅ (路由在)"; else ng "/api/match            → $H2 (期望 401,真 404 = 后端没新路由)"; fi
if [[ "$H3" == "401" ]]; then ok "/api/jobpilot/profile-diagnose → $H3 ✅"; else ng "/api/jobpilot/profile-diagnose → $H3 (期望 401)"; fi
if [[ "$H4" == "401" ]]; then ok "/api/ai/assist-field  → $H4 ✅"; else ng "/api/ai/assist-field  → $H4 (期望 401)"; fi

# ============= 7. 总结
hdr "7. 总结"
printf "  \033[1;32mPASS: %d\033[0m\n" "$PASS"
printf "  \033[1;31mFAIL: %d\033[0m\n" "$FAIL"
printf '\n'

if [[ $FAIL -eq 0 ]]; then
  printf '\033[1;32m✅ ALL PASS — deployment looks healthy\033[0m\n'
  printf '   - commit: %s\n' "$(git rev-parse --short HEAD)"
  printf '   - DB backup: %s\n' "$BACKUP_FILE"
  printf '   - 你现在可以:\n'
  printf '     1. 重启 WeChat IDE / 清缓存\n'
  printf '     2. 进小程序 → 首页 → 🚀 找岗位 → 走 5 步\n'
  printf '     3. backend 真有 token 后,/api/match 应回 200 + 匹配列表\n'
  exit 0
else
  printf '\033[1;31m❌ FAIL — some checks did not pass\033[0m\n'
  printf '   失败项:\n'
  for r in "${RESULTS[@]}"; do
    if [[ "$r" == ✗* ]]; then printf '     %s\n' "$r"; fi
  done
  printf '\n'
  printf '   下一步:\n'
  printf '     1. 把上面 4 行 ✗ 项贴给我\n'
  printf '     2. 我看具体失败 → 给定向修复\n'
  exit 1
fi
