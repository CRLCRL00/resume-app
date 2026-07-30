# Stage 环境 实施指南

> Stage = 接近生产的镜像，但用独立 DB/Redis + 测试数据。Phase 8+ 后启用。

## 1. 目标

- 部署前 staging 跑一遍真实流量（mock 数据）
- 验证新版本 / 配置变更不破坏现有路径
- 调试生产问题（脱敏后重现）

## 2. 与生产差异

| 维度 | Production | Stage |
|------|-----------|-------|
| 数据库 | `resume_app` | `resume_app_stage` |
| Redis DB | 0 | 1 (或独立 Redis 实例) |
| 域名 | 待 ICP + 真实 CA | serveo.net tunnel / 自签 |
| Tunnel | `https://*.serveousercontent.com` | `https://*.serveousercontent.com` (重新跑) |
| LLM Key | 真实 DeepSeek | 同 key 或 test 专用（rate limit 区别） |
| .env | `NODE_ENV=production` | `NODE_ENV=staging` |
| 后台端口 | 3003 | 3004（不同端口） |
| 监控 | 真实 monitor + alert | 同 / 单独 webhook URL |

## 3. 一次性创建（server side）

```bash
# 1. 数据库（用 root 凭据建库）
mysql -u root -p"$DB_ROOT_PASSWORD" -e "
CREATE DATABASE resume_app_stage;
GRANT SELECT, INSERT, UPDATE, DELETE ON resume_app_stage.* TO 'resume_app_user'@'localhost';
FLUSH PRIVILEGES;
"

# 2. seed（用专用户）
DB_NAME=resume_app_stage mysql -u resume_app_user -p"$DB_PASSWORD" < backend/src/db/schema.sql

# 3. Redis DB index 1（独立 keyspace）
# redis 默认 0 db，stage 用 1
# 验证：redis-cli -n 1 ping  → PONG

# 4. .env.stage
cat > /opt/resume-app/backend/.env.stage <<EOF
NODE_ENV=staging
PORT=3004
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=resume_app_user
DB_PASSWORD=$DB_PASSWORD
DB_NAME=resume_app_stage
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_DB=1
JWT_SECRET=$STAGE_JWT_SECRET
DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
WX_SECRET=$WX_SECRET_STAGE
EOF

# 5. PM2 config
cd /opt/resume-app/backend
PORT=3004 NODE_ENV=staging pm2 start src/index.js --name resume-app-stage \
  --max-memory-restart 200M --log-date-format YYYY-MM-DD-HH-mm-ss

# 6. nginx（如果需要独立外网）
# 复用同 server 443，server_name stage.crlcrl.com（待 ICP）
# 或直接 expose 3004：
#  - 用 serveo.net 单独跑
#  - pm2 后用 ssh 隧道
```

## 4. CI/CD（建议做法）

PR merged → 自动 deploy stage：

```yaml
# .github/workflows/deploy-stage.yml
name: deploy stage
on: { push: { branches: [develop] } }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: rsync to stage host
        run: rsync -az ./ stage-host:/opt/resume-app-stage/
      - name: restart stage backend
        uses: appleboy/ssh-action@v1
        with:
          host: stage-host
          script: |
            cd /opt/resume-app-stage/backend
            npm install --production
            DATABASE_URL=mysql2://... npm run db:migrate
            pm2 restart resume-app-stage --update-env
```

待 ICP + 真域名后才需要。当前 per-PR 不行 — 用本地 run scripts 即可。

## 5. 数据同步（脱敏）

```bash
# 从生产导出，加密传给 stage
mysqldump --single-transaction resume_app | gzip > prod-snap.sql.gz
gpg --recipient ops@crlcrl.com --encrypt prod-snap.sql.gz
# 传到 stage：
scp prod-snap.sql.gz.gpg stage-host:/tmp/
ssh stage-host "gpg --decrypt /tmp/prod-snap.sql.gz.gpg | mysql resume_app_stage"
```

⚠️ 自动化需要责任分担（生产数据脱敏 PII）。Phase 9+ 再做。

## 6. 校验表

启动 stage 后，本周通过以下检查：

- [ ] 5x `npm test` 120+ pass
- [ ] smoke-e2e.js 9-11 critical pass
- [ ] smoke-userflow.js 6 critical pass
- [ ] `pm2 logs resume-app-stage` 无 stack trace
- [ ] `/api/health/deep` 200 + 0 degraded
- [ ] LLM 真调一次：fe → preview → generate → match 全链路

## 7. 推广决策

Stage 验证：
- 启用 1 周后无 issue → 生产同样升级
- 如果是 schema migration：先 stage，success 24h 后生产
- 如果是 LLM prompt 调整：先 stage A/B test（用小流量 1 天）

## 8. 当前状态

**未启用**。Phase 8+ 阶段不强制要求 — 当前真实部署 + 真机调试 + 审核 = 完整链路。Stage 价值在于 Phase 9+（高频发布 + 多 dev + 严格隔离）。

## 9. 升级步骤

需要时再启：
1. server 上创建 resume_app_stage DB + .env.stage
2. pm2 加 resume-app-stage 实例（端口 3004）
3. nginx 加 server block `stage.crlcrl.com` → 3004
4. CI 写 .github/workflows/deploy-stage.yml
5. 真域名 + 通配 cert 后启用 DNS

预计总耗时：1 工作日。
