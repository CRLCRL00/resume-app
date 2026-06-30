# Secret 轮换 Runbook

> 定期轮换的密钥 + 步骤，避免泄露。

## 1. ALERT_TOKEN（监控 webhook 共享密钥）

**用途**：`monitor.sh` 调 `/api/internal/alert` 时的鉴权 + HMAC 签名。
**轮换频率**：90 天或发现泄露立即轮换。

**轮换步骤**：
1. server 改 `.env`：`ALERT_TOKEN=<new-token>`
2. `/etc/cron.d/resume-app-monitor` 调用 `monitor.sh` 用 env var，新 env 须从 server `/opt/resume-app/backend/.env` 加载（cron env 独立）
3. 本地更新 `monitor.sh` 同 env var：
   ```bash
   export ALERT_TOKEN=<new-token>
   # 写入 ~/.bashrc 或 /etc/monitor.env
   ```
4. `pm2 restart resume-app-backend --update-env`
5. 手动触发一次：
   ```bash
   /usr/local/bin/monitor-resume-app.sh
   tail -3 /var/log/resume-app-monitor.log
   tail -5 /var/log/resume-app-alerts.log
   ```
6. 旧 token 立即失效（无 overlap window）；如需 overlap 临时支持，可在 `routes/alerts.js` 加 `LEGACY_ALERT_TOKEN` env。

## 2. JWT_SECRET（JWT 签名密钥）

**用途**：所有 JWT token 签名 / 验签。
**轮换频率**：180 天（vs JWT 30 天过期）。

**影响**：轮换 = 所有旧 token 失效 → 所有用户需重新登录。

**轮换步骤**（maintenance window）：
1. server `.env`：`JWT_SECRET=<new-secret>`
2. `pm2 restart resume-app-backend --update-env`
3. 用户下次请求 → 401 token invalid → 自动转 wx.login 重新登录
4. ~30 min 后绝大多数 token 都已过期

⚠️ **不可逆操作**：提前通知（应用内弹窗 + 服务公告 24h）。

## 3. DEEPSEEK_API_KEY

**用途**：调 DeepSeek LLM 鉴权。
**轮换频率**：发现泄露立即；日常 365 天。

**轮换步骤**：
1. DeepSeek 平台 → API Keys → 创建新 key → 禁用旧 key
2. server `.env`：`DEEPSEEK_API_KEY=<new-key>`
3. `pm2 restart resume-app-backend --update-env`
4. verify：
   ```bash
   curl -sk https://43.139.176.199/api/health/deep
   # 然后生成一次简历：
   node scripts/smoke-userflow.js
   # 期望 log: 'llm usage' + 200
   ```
5. 旧 key 在 DeepSeek 平台撤销

## 4. WX_SECRET（微信 code2session）

**轮换频率**：365 天或泄露立即。
**轮换步骤**：
1. mp.weixin.qq.com → 开发 → 开发设置 → 重置 AppSecret
2. server `.env`：`WX_SECRET=<new-secret>`
3. `pm2 restart resume-app-backend --update-env`
4. 立即生效 — 旧 code 仍有效（code 在 5min TTL），新 code 用新 secret

⚠️ 重置后**旧的 code 立刻全部失效**（正在进行中的 wx.login 流程会失败）。

## 5. DB_PASSWORD / REDIS_PASSWORD

**轮换频率**：365 天或泄露立即。
**轮换步骤**：
1. 在 DB / Redis 服务端改密码
2. server `.env` 同步
3. `pm2 restart resume-app-backend --update-env`
4. 验证：smoke-e2e.js / 5x npm test

⚠️ 数据库密码通常需在 DB 服务本身改 + .env 改 + 应用重启。

## 6. 操作流程

任何轮换：

```
1. 备份当前 .env
   cp /opt/resume-app/backend/.env /opt/resume-app/backend/.env.bak.YYYYMMDD
2. 改 .env
3. pm2 restart resume-app-backend --update-env
4. 验证 (smoke-e2e + curl /health/deep + 真实调用路径)
5. 记录到 RUNBOOK.md变更历史（git log）
6. 24h 后删除 backup
```

## 7. 自动化（未实现）

Phase 9+ 候选：cron 每月检查 secret 年龄，>90 天 WARN，>365 天 ALERT 邮件/Slack。

## 8. 紧急撤销（compromised key）

```
立即:
  1. server .env 中改为 'REVOKED-' 前缀的新值
  2. pm2 restart
  3. 通知用户（必要时强制重新登录）
  4. log 到 security_event / 同步 devlog
后续:
  - 申请新 secret，按上节步骤轮换
  - 排查泄露点（git log, npm audit, 服务器历史命令）
```
