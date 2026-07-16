# Server 部署 SOP — R40-R90 (2026-07-16)

> **状态**: 用户真机 preview 触发 502 — server backend 还停在 Phase 5 commit `b15b532`, R57+ 没真部署.
> **目标**: 把 server 升级到 `develop` HEAD, 启用 R84+ SSE + R90 加密 + AOF.

## 现状 (server 端已知)

| 项 | 现状 | 来源 |
|---|---|---|
| pm2 resume-app-backend | ❌ fail: `MODULE_NOT_FOUND pino-pretty` 等 | R86 deploy 时观察到 |
| git HEAD | `b15b532` (Phase 5) | git log |
| node_modules | 不全 / 与 commit 不匹配 | pm2 error |
| Redis AOF | 未知 (R90-B 待 verify) | 需 `infra/redis-check-aof.sh` |
| SSE_REPLAY_KEY env | 未设 | 需生成 |

## 部署步骤 (需你跑)

### 1. SSH 进 server

```bash
ssh -i ~/.ssh/openclaw.pem -o StrictHostKeyChecking=no ubuntu@43.139.176.199
```

### 2. 看现状

```bash
pm2 logs resume-app-backend --lines 30 --nostream | tail -20
cd /opt/resume-app && git log --oneline -3
cd /opt/resume-app/backend && ls node_modules | head -20
```

### 3. 拉 R40-R90 (需先解决 GitHub 访问)

Server 当前 `git pull` 失败 (`git@github.com: Permission denied`). 三个方案:

**方案 A: 加 SSH key (推荐)**
```bash
# 你本机
cat ~/.ssh/openclaw.pem  # 已有
# 上传到 server
scp -i ~/.ssh/openclaw.pem ~/.ssh/openclaw.pem ubuntu@43.139.176.199:~/.ssh/github_deploy.pem
ssh -i ~/.ssh/openclaw.pem ubuntu@43.139.176.199
# server
chmod 600 ~/.ssh/github_deploy.pem
# 添加到 GitHub repo deploy key (你有 admin 权限的话)
# 或用 https + token
```

**方案 B: HTTPS + Personal Access Token**
```bash
# server
cd /opt/resume-app
git remote set-url origin https://YOUR_TOKEN@github.com/OWNER/REPO.git
git pull --rebase
```

**方案 C: 本机 rsync/scp 推送 (无 git push)**
```bash
# 你本机
rsync -avz --exclude=node_modules --exclude=.git \
  -e "ssh -i ~/.ssh/openclaw.pem" \
  /d/项目/简历app/ ubuntu@43.139.176.199:/opt/resume-app/
```

### 4. 装 deps

```bash
cd /opt/resume-app/backend
rm -rf node_modules package-lock.json
npm ci
```

### 5. 跑 migrations (R62)

```bash
# 你之前 R63.A 没跑 GRANT, 这次顺便
mysql -u root -p resume_app < <(echo "GRANT CREATE, ALTER, DROP ON resume_app.* TO 'resume_app_user'@'localhost'; FLUSH PRIVILEGES;")
# 然后
node scripts/db-init.js --test  # dry-run
```

### 6. 生成 SSE_REPLAY_KEY (R90-C)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 输出: <64 hex chars>
# 保存到 server:
sudo bash -c "echo 'SSE_REPLAY_KEY=<that-value>' >> /opt/resume-app/backend/.env"
```

### 7. Redis AOF (R90-B)

```bash
# 永久改 /etc/redis/redis.conf
sudo bash -c "echo 'appendonly yes' >> /etc/redis/redis.conf"
sudo bash -c "echo 'appendfsync everysec' >> /etc/redis/redis.conf"
sudo systemctl restart redis
redis-cli ping  # PONG
bash /opt/resume-app/infra/redis-check-aof.sh  # 应 ✅
```

### 8. 启动 backend

```bash
cd /opt/resume-app/backend
pm2 delete resume-app-backend 2>/dev/null
pm2 start ecosystem.config.js --only resume-app-backend
pm2 logs resume-app-backend --lines 20 --nostream
# 看无 MODULE_NOT_FOUND = OK
curl -sS http://127.0.0.1:3003/api/health/live -w '\nhealth: %{http_code}\n'
# 应 200
```

### 9. pm2 设 SSE_REPLAY_KEY (防止重启丢)

```bash
# 写入 ecosystem 或 pm2 env
pm2 set resume-app-backend SSE_REPLAY_KEY <that-value>
pm2 save
```

### 10. 真机 preview 重测

- 小程序 IDE → 真机扫码
- Console 应无 `getSystemInfoSync is deprecated` (R91-B fix)
- `https://43.139.176.199/api/legal/versions` 应 200 (有 backend 了)
- `https://43.139.176.199/api/resume/current` 应 200 或 401 (无 token)

## 验证清单

| 检查 | 命令 | 期望 |
|---|---|---|
| backend up | `curl /api/health/live` | 200 |
| SSE 端点 | `curl /api/admin/dashboard/stream` (admin token) | event-stream |
| Redis AOF | `bash infra/redis-check-aof.sh` | ✅ |
| Replay buffer 加密 | `redis-cli get sse:replay:buffer` | base64 密文 (非 JSON) |
| 真机 console | 扫码 preview | 无 deprecation warning |
| 真机 legal/versions | `curl /api/legal/versions` | 200 JSON |

## 留 follow-up (部署后)

| # | 项 |
|---|---|
| 1 | 真机 preview 全 dashboard 全屏 1920×1080 verify |
| 2 | WX code-upload key 轮换 |
| 3 | tunnel upgrade (serveo Pro / ngrok / cloudflared) |
| 4 | ICP 备案 |
| 5 | GitHub repo deploy key (避免用 PAT) |

## 风险

| 风险 | 缓解 |
|---|---|
| npm ci 拉新 deps 可能挂 | `npm audit` 后修, 或 `npm install --legacy-peer-deps` |
| AOF 启用后 Redis 启动慢 (rewrite) | 给 60s 启动时间 |
| pm2 env SSE_REPLAY_KEY 持久 | `pm2 save` + 写 ecosystem |
| 真机 IP `43.139.176.199` 仍 502 | nginx upstream 检查, `systemctl status nginx` |