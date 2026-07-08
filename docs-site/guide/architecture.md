# 架构

## 系统总览

```
┌─────────────────┐     ┌──────────────────────┐     ┌────────────┐
│ 微信小程序      │ ──→ │ Express 后端 (3003)  │ ──→ │ MySQL 8    │
│ 5+3 pages       │ ←── │ Node 22 + JWT       │ ←── │ Redis 7    │
└─────────────────┘     │  + DeepSeek LLM      │     └────────────┘
                        └──────────────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │ serveo.net   │ ← 真机可达 HTTPS tunnel
                        │ tunnel       │
                        └──────────────┘
```

## 后端模块

```
backend/src/
  app.js              ← createApp() 装配中间件 + 路由
  index.js            ← 入口（pm2 启动）
  routes/
    auth.js           ← 微信 code2session + JWT
    resume.js         ← 简历 CRUD + 生成
    match.js          ← 岗位匹配
    jobs.js           ← 岗位查询
    admin/            ← 后台管理（jobs, prompts, logs, 2fa, queries, ...）
    metrics.js        ← Prometheus 暴露
    metricsAlerts.js  ← 告警评估器 (R31)
    openapi.js        ← OpenAPI 3.0 文档
    health.js         ← /api/health + /ready
  services/
    matchService / matchPrompt / jobFilter
    resumeGenerator / resumePrompt / resumeTemplate
    llm.js            ← DeepSeek 调用 + 重试
    twoFactor.js      ← TOTP RFC 6238
    adminLog.js       ← 操作审计 (R36)
    alertRouter.js    ← Slack 通知 + dedupe (R32)
    queryMetrics.js   ← 慢查询 ring buffer (R35)
  middleware/
    auth / adminAuth / rateLimit / slidingRateLimit
    twoFactorRequired / csrf / idempotency
  jobs/
    adminLogsCleanup.js   ← 180 天保留 cron (R36)
    clientErrorsCleanup.js
```

## 数据流：用户提交 → 简历生成 → 匹配

1. 小程序 → `POST /api/resume/generate` 带 user JWT
2. 后端取用户草稿，调 DeepSeek 拿 `content_md`（mock-able）
3. 持久化到 `resumes` 表
4. 小程序 → `POST /api/match` 拿用户期望（城市/薪资/行业）
5. 后端：
   - 关键词过滤人工维护的 jobs（`jobFilter`）
   - LLM rerank（`matchService`）
6. 返回 top N 公司+岗位

## 部署链

- 后端：`Actions/Deploy` → SCP tar → 服务器 `scripts/deploy.sh` → pm2 reload → smoke
- 小程序：push develop → `upload-miniprogram.yml` → 体验版
- 文档：push main → `docs-deploy.yml` → GitHub Pages（本文站）

## 关键能力（R31-R36）

| Round | 能力 | 文件 |
|-------|------|------|
| R31 | in-process 告警评估器 | `routes/metricsAlerts.js` |
| R32 | Slack 路由 + dedupe + chaos | `services/alertRouter.js`, `tests/chaos/` |
| R33 | Admin 2FA TOTP | `services/twoFactor.js`, `routes/admin/twoFactor.js` |
| R35 | 慢查询 ring buffer | `services/queryMetrics.js`, `routes/admin/queries.js` |
| R36 | 审计过滤 + 保留 cron | `routes/admin/logs.js`, `jobs/adminLogsCleanup.js` |
