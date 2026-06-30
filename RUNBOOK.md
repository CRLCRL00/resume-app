# RUNBOOK

> 运维手册：部署 / 监控 / 故障排查。
> 适用：当前 43.139.176.199（生产）+ Local dev。

## 一、部署

### 初次部署

```bash
ssh ubuntu@43.139.176.199
# 1. 安装 Node.js 22 / MySQL 8 / Redis 7 + nginx + pm2 + cert（已有则跳过）
# 2. clone
git clone git@github.com:CRLCRL00/resume-app.git /opt/resume-app
# 3. 后端环境
cd /opt/resume-app/backend
cp .env.example .env
# 编辑 .env 填 DB / Redis / DeepSeek / WX 凭证
npm install --production
npm run db:init
# 4. PM2 启动
PORT=3003 pm2 start src/index.js --name resume-app-backend
# 5. nginx 配置（详见 docs/audit/）
# 6. mini-program 需在 mp.weixin.qq.com 后台填类目 + 白名单（详见 docs/audit/微信管理后台操作手册.md）
```

### 代码更新（日常）

```bash
# 本地仓库 commit + push 已做。
# Server:
ssh ubuntu@43.139.176.199
cd /opt/resume-app
# 法 1: git pull（要求 server outbound 通 github.com）
git pull origin develop
# 法 2: tar/scp（如 outbound 受限）
#   本地: tar --exclude='.git' --exclude='node_modules' --exclude='.env' -czf /tmp/bundle.tar.gz backend/ mini-program/ docs/ devlog/
#   scp /tmp/bundle.tar.gz ubuntu@43.139.176.199:/tmp/
#   server: tar -xzf /tmp/bundle.tar.gz  # 覆盖原文件
pm2 restart resume-app-backend --update-env
```

> ⚠️ Server `.env` 不要从 local 覆盖 — 单独维护。

## 二、监控

### 关键 URL

| 路径 | 用途 |
|------|------|
| `GET /api/health` | 进程在/否 |
| `GET /api/health/deep` | DB + Redis ping，503 即 degraded |
| `https://43.139.176.199/api/legal/privacy` | 微信审核 / 接口 smoke |

### 日志位置

```bash
# 后端运行日志（pm2）
pm2 logs resume-app-backend --lines 30 --nostream
# 或文件
cat /home/ubuntu/.pm2/logs/resume-app-backend-out.log

# 备份日志
tail -f /var/log/resume-app-backup.log

# Nginx 错误日志
sudo tail -f /var/log/nginx/error.log
```

### 备份验证

```bash
# 触发一次手动
sudo /usr/local/bin/backup-resume-app.sh
# 验证最新备份可恢复
LATEST=$(ls -t /var/backups/resume-app/*.sql.gz | head -1)
zcat "$LATEST" | grep -E "^CREATE TABLE|^INSERT" | head
# COUNT 含 7 表 ✓
# size 应 > 5KB
```

## 三、故障排查

### 后端 502/connection error

```bash
# 1. 后端进程在吗？
pm2 list | grep resume-app-backend
# 2. 后端日志
pm2 logs resume-app-backend --lines 50 --nostream
# 3. DB 连得上吗？
mysql -u resume_app_user -p"$DB_PASSWORD" resume_app -e "SELECT 1;"
# 4. Redis 连得上吗？
redis-cli -a "$REDIS_PASSWORD" ping
# 5. nginx 配置
sudo nginx -t
sudo systemctl status nginx
```

### /api/legal/* 404

```bash
# server 上 backend 代码是不是 latest？
cd /opt/resume-app/backend && git log --oneline -1
# 应为最新 commit hash
# 否则 git pull / tar 重 deploy + pm2 restart
```

### /api/resume/generate 502 (LLM fail)

```bash
# 1. DeepSeek key 是否过期？
curl -sk https://api.deepseek.com/v1/models -H "Authorization: Bearer $DEEPSEEK_API_KEY"
# 2. 改 .env 后 pm2 restart
```

### Tunnel (serveo) 断了

```bash
# 看 tunnel 在不在
ps -ef | grep -v grep | grep 'ssh.*serveo'
# 如果挂了，杀 + 重建
pkill -f 'ssh.*serveo'
nohup setsid ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
  -R 80:localhost:3003 serveo.net < /dev/null > /tmp/serveo.log 2>&1 &
disown
sleep 10
cat /tmp/serveo.log   # 拿到新的 https://*.serveousercontent.com
```

### npm test 全量 hang

```bash
# 当前通过：--test-concurrency=1 + --test-force-exit
cd backend
npm test -- --test-concurrency=1 --test-force-exit
# 应 ~10s 内退出
```

## 四、回滚

```bash
# 回滚到前一 commit
ssh ubuntu@43.139.176.199
cd /opt/resume-app
git log --oneline -5  # 找前 commit hash
git reset --hard <prev-commit>
pm2 restart resume-app-backend --update-env
```

## 五、迁移 / 备份恢复

```bash
# 模拟恢复（DR 演练，每月做一次）
LATEST=$(ls -t /var/backups/resume-app/*.sql.gz | head -1)
mysql -u root -p -e "CREATE DATABASE resume_app_test;"
zcat "$LATEST" | mysql -u root -p resume_app_test
# 验证
mysql -u root -p resume_app_test -e "SHOW TABLES; SELECT COUNT(*) FROM users;"
```

## 六、监控告警建议

（未来 cron + push）：
- 每日 cron：调 `/api/health/deep`，失败 → 邮件/Slack 告警
- 每日 cron：检查 `/var/backups/resume-app/*.sql.gz` 大小（< 1KB 视为 backup 失败）
- 每周 cron：`pm2 logs resume-app-backend | grep ERROR` → 邮件汇总

## 七、变更窗口

| 项 | 何时 |
|------|------|
| 后端代码 | 随时（已 PM2 with --update-env）|
| 数据库 schema | 低峰期，提前备份 + rollback 步骤 |
| nginx / TLS 配置 | 提前测试 + 配置 reload 验证 |
| 微信小程序上传 | 微信审核时（避免审核中）|

## 八、联系人

- 项目 owner：CRL
- Server root：ubuntu@43.139.176.199（sudo 限日常运维）
- 微信管理员：mp.weixin.qq.com 扫码后台
