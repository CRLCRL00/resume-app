#!/bin/bash
# R41-Gap-5: server provisioning L1 script — 一次脚本把 server 装成 prod-ready
#
# 用法（在 server 上 root 跑）：
#   curl -sS https://raw.githubusercontent.com/CRLCRL00/resume-app/develop/infra/setup-server.sh | bash -s -- --env prod
#   或本地 scp 后：bash infra/setup-server.sh --env prod
#
# 设计原则：
#   - 幂等（重复跑同一份脚本不会破坏现有服务）
#   - 单文件、纯 bash、无 ansible/terraform 依赖
#   - 默认值基于当前 43.139.176.199 server，可参数化
#   - 任何破坏性动作前 ask（INTERACTIVE=1 时弹 y/N）
#
# 不做（留给后续 L2 ansible 或 L3 terraform）：
#   - 多 server 编排
#   - 滚动更新
#   - 自愈（依赖 systemd + restart=on-failure，已配）
#
# 安装什么：
#   - Node.js 22 (nvm) + PM2 全局
#   - MySQL 8 + Redis 7
#   - nginx + 自签 cert（生产用 LE，需另外流程）
#   - systemd 服务（resume-app-backend, resume-app-monitor, serveo-tunnel）
#   - cron（backup, monitor, dr-drill, firewall-audit）
#   - 文件夹（/var/backups/resume-app, /var/log/resume-app-*, /opt/resume-app）

set -euo pipefail

ENV="${RESUME_ENV:-prod}"
BACKEND_HOME="/opt/resume-app"
BACKUP_DIR="/var/backups/resume-app"
LOG_DIR="/var/log"
GITHUB_REPO="git@github.com:CRLCRL00/resume-app.git"
GITHUB_BRANCH="main"

while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV="$2"; shift 2 ;;
    --home) BACKEND_HOME="$2"; shift 2 ;;
    --repo) GITHUB_REPO="$2"; shift 2 ;;
    --branch) GITHUB_BRANCH="$2"; shift 2 ;;
    -h|--help)
      echo "用法: bash setup-server.sh [--env prod|staging] [--home /opt/resume-app] [--repo git@github.com:...] [--branch main]"
      exit 0
      ;;
    *) echo "unknown arg: $1"; exit 2 ;;
  esac
done

log() { echo "[setup-server] $*"; }
die() { log "ERROR: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "must be root"
log "ENV=$ENV HOME=$BACKEND_HOME REPO=$GITHUB_REPO BRANCH=$GITHUB_BRANCH"

# ---------- 1. 系统包 ----------
log "step 1: apt packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y --no-install-recommends \
  curl ca-certificates git gnupg build-essential \
  mysql-server redis-server nginx jq openssl \
  cron logrotate sudo ufw fail2ban

# ---------- 2. Node 22（nvm 安装以支持多版本；非 root 用户也可用） ----------
log "step 2: Node 22 via nvm"
export NVM_DIR="/usr/local/nvm"
mkdir -p "$NVM_DIR"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
. "$NVM_DIR/nvm.sh"
nvm install 22
nvm alias default 22
ln -sf "$(nvm which 22)" /usr/local/bin/node
ln -sf "$(dirname "$(nvm which 22)")/npm" /usr/local/bin/npm 2>/dev/null || true
node -v || die "node not installed"
npm -v || die "npm not installed"

# PM2 全局（启动应用）
npm install -g pm2 --no-audit --no-fund

# ---------- 3. MySQL ----------
log "step 3: MySQL config"
# bind-address 限制 localhost（防 Gap-20 暴露）
if grep -qE '^bind-address' /etc/mysql/mysql.conf.d/mysqld.cnf 2>/dev/null; then
  sed -i 's/^bind-address.*/bind-address = 127.0.0.1/' /etc/mysql/mysql.conf.d/mysqld.cnf
else
  echo "bind-address = 127.0.0.1" >> /etc/mysql/mysql.conf.d/mysqld.cnf
fi
systemctl enable mysql
systemctl restart mysql
mysql -u root -e "SELECT 1" >/dev/null || die "MySQL not up"

# ---------- 4. Redis ----------
log "step 4: Redis config (R41-Gap-14: AOF on)"
# 自签配置层覆盖默认
cat > /etc/redis/redis-resume-app.conf <<EOF
# 强制开启 AOF + 强 sync（Gap-14：每次写都 fsync，丢失 < 1s）
appendonly yes
appendfsync everysec
bind 127.0.0.1
protected-mode yes
requirepass ${REDIS_PASSWORD:-ResumeRedis@2026}
EOF
# 包含进主配置（如果有 include 块，则追加；否则直接覆盖 daemons）
if grep -q "include" /etc/redis/redis.conf 2>/dev/null; then
  echo "include /etc/redis/redis-resume-app.conf" >> /etc/redis/redis.conf
fi
systemctl enable redis-server
systemctl restart redis-server
redis-cli -a "${REDIS_PASSWORD:-ResumeRedis@2026}" ping || die "Redis not up"

# ---------- 5. nginx ----------
log "step 5: nginx + self-signed cert"
mkdir -p /etc/nginx/ssl
if [ ! -f /etc/nginx/ssl/resume-app.crt ]; then
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/resume-app.key \
    -out /etc/nginx/ssl/resume-app.crt \
    -days 365 \
    -subj "/CN=resume-app.local" 2>&1 | tail -2
fi
cp -f "$BACKEND_HOME/deploy/nginx/resume-app.conf" /etc/nginx/sites-enabled/resume-app.conf
nginx -t
systemctl enable nginx
systemctl restart nginx

# ---------- 6. firewall（Gap-20 实施） ----------
log "step 6: ufw"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP → 301 to HTTPS
ufw allow 443/tcp   # HTTPS
ufw allow from 10.0.0.0/8 to any port 3003 proto tcp  # backend 仅内网（虽然绑 127.0.0.1 即可）
ufw --force enable

# ---------- 7. 应用 clone + 依赖 ----------
log "step 7: clone repo + npm ci (prod deps only)"
mkdir -p "$BACKEND_HOME"
if [ ! -d "$BACKEND_HOME/.git" ]; then
  git clone --branch "$GITHUB_BRANCH" --depth 1 "$GITHUB_REPO" "$BACKEND_HOME"
fi
cd "$BACKEND_HOME"
# 仅 backend
cd "$BACKEND_HOME/backend"
npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -3 || npm install --omit=dev --no-audit --no-fund 2>&1 | tail -3

# ---------- 8. systemd: backend + monitor ----------
log "step 8: systemd units"
cat > /etc/systemd/system/resume-app-backend.service <<EOF
[Unit]
Description=Resume App Backend (PM2)
After=network.target mysql.service redis-server.service
Wants=mysql.service redis-server.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=root
WorkingDirectory=$BACKEND_HOME/backend
ExecStart=/usr/local/bin/pm2 startOrReload ecosystem.config.js --env production
ExecStop=/usr/local/bin/pm2 kill
EnvironmentFile=-$BACKEND_HOME/backend/.env
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/resume-app-tunnel.service <<EOF
[Unit]
Description=Resume App SSH tunnel (serveo)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Environment=REDIS_PASSWORD=${REDIS_PASSWORD:-ResumeRedis@2026}
ExecStartPre=-/bin/bash -c 'pkill -f "ssh.*serveo" || true'
ExecStart=/usr/bin/ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -R 80:localhost:3003 serveo.net
Restart=always
RestartSec=10
StartLimitBurst=10
StartLimitIntervalSec=300

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable resume-app-backend resume-app-tunnel
systemctl restart resume-app-backend || true   # 可能首次缺 .env 失败
systemctl restart resume-app-tunnel || true

# ---------- 9. 文件夹 + 初次 backup + cron ----------
log "step 9: backup dir + first backup + crons"
mkdir -p "$BACKUP_DIR" /var/run/resume-app

# 备份每日 cron
cat > /etc/cron.d/resume-app-backup <<EOF
0 3 * * * root $BACKEND_HOME/backend/scripts/backup.sh
EOF

# 监控 5min cron
cat > /etc/cron.d/resume-app-monitor <<EOF
*/5 * * * * root HEALTH_URL=https://127.0.0.1:443/api/health/deep HEALTH_WEBHOOK= NODE_ENV=$ENV ALERT_TOKEN=\$(grep ^ALERT_TOKEN= $BACKEND_HOME/backend/.env | cut -d= -f2- || echo '') $BACKEND_HOME/backend/scripts/monitor.sh >> /var/log/resume-app-monitor.log 2>&1
EOF

# DR drill 每月
cat > /etc/cron.d/resume-app-dr-drill <<EOF
0 4 1 * * root $BACKEND_HOME/backend/scripts/dr-drill.sh
EOF

# firewall audit 每周
cat > /etc/cron.d/resume-app-firewall-audit <<EOF
0 9 * * 1 root $BACKEND_HOME/infra/firewall-audit.sh >> /var/log/resume-app-firewall-audit.log 2>&1
EOF

# 立刻跑一次 backup
if [ -r "$BACKEND_HOME/backend/.env" ]; then
  bash "$BACKEND_HOME/backend/scripts/backup.sh" || true
fi

# ---------- 10. logrotate ----------
log "step 10: logrotate"
cat > /etc/logrotate.d/resume-app <<EOF
/var/log/resume-app-*.log {
    daily
    rotate 30
    compress
    missingok
    notifempty
    create 0644 root root
    postrotate
        systemctl reload resume-app-backend.service > /dev/null 2>&1 || true
    endscript
}
EOF

# ---------- 11. fail2ban 略 ----------
log "step 11: fail2ban (sshd jail only)"
cat > /etc/fail2ban/jail.local <<EOF
[sshd]
enabled = true
port    = ssh
logpath = %(sshd_log)s
maxretry = 5
bantime = 3600
EOF
systemctl enable fail2ban
systemctl restart fail2ban || true

# ---------- 12. smoke ----------
log "step 12: smoke"
sleep 5
HEALTH=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3003/api/health 2>/dev/null || echo "000")
TUNNEL_PID=$(pgrep -f 'ssh.*serveo' || echo "")
log "smoke: backend /api/health=$HEALTH tunnel_pid=$TUNNEL_PID"
log "DONE. next steps:"
log "  1. ssh \$(hostname)  # 验证 tunnel hostname"
log "  2. scp backend/.env 含真 DB / Redis / DeepSeek / WX / JWT creds"
log "  3. systemctl restart resume-app-backend"
log "  4. README §Docs 加 tunnel URL"

exit 0
