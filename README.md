# 简历推荐小程序

微信小程序：用户填资料 → LLM 自动生成简历 → 语义匹配人工维护的岗位库 → 推荐公司+岗位。

[![Tests](https://github.com/CRLCRL00/resume-app/actions/workflows/backend-test.yml/badge.svg)](https://github.com/CRLCRL00/resume-app/actions/workflows/backend-test.yml)

## 架构

```
┌─────────────────┐     ┌──────────────────────┐     ┌────────────┐
│ 微信小程序      │ ──→ │ Express 后端 (3003)  │ ──→ │ MySQL 8    │
│ 5+5 pages       │ ←── │ Node 22 + JWT       │ ←── │ Redis 7    │
└─────────────────┘     │  + DeepSeek LLM      │     └────────────┘
                        └──────────────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │ serveo.net   │ ← 真机可达 HTTPS tunnel
                        │ tunnel       │
                        └──────────────┘
```

## 文档导航

| 链接 | 说明 |
|------|------|
| [docs/index.md](./docs/index.md) | 完整文档索引（从这里开始）|
| [RUNBOOK.md](./RUNBOOK.md) | 运维 / 部署 / 故障排查 |
| [docs/audit/微信管理后台操作手册.md](./docs/audit/微信管理后台操作手册.md) | 微信小程序后台手动操作 |

## 快速开始（开发环境）

```bash
# 1. 安装依赖
cd backend && npm install

# 2. 配置环境（从 .env.example 复制）
cp backend/.env.example backend/.env
# 编辑 .env 填 DB / REDIS / DeepSeek / WX 凭证

# 3. 初始化数据库
npm run db:init

# 4. 启动
npm start                      # 生产模式
npm run dev                    # watch 模式
npm test                       # 跑测试（114 用例，~10s）

# 5. 微信小程序
# 微信开发者工具 → 打开 mini-program/
# 详情 → 本地设置 → 不校验合法域名（开发阶段）
```

## 项目结构

```
resume-app/
├── backend/                       # Express API
│   ├── src/
│   │   ├── app.js                 # createApp() 装配所有路由
│   │   ├── index.js               # 入口（pm2 启动）
│   │   ├── routes/                # 路由（auth, resume, match, admin, legal, ...）
│   │   ├── services/              # 业务（match, llm, jobFilter, ...）
│   │   ├── middleware/            # auth, adminAuth, rateLimit, ...
│   │   ├── utils/                 # logger (with redact), token, format
│   │   └── config/                # env 加载
│   ├── tests/                     # node:test 单测
│   ├── scripts/                   # db-init, smoke-e2e, smoke-userflow, backup.sh
│   └── package.json
├── mini-program/                  # 微信小程序（8 pages: 3 主 + 2 legal + 3 admin）
├── docs/                          # 设计 / 计划 / 审核材料
│   ├── superpowers/{specs,plans}/
│   ├── manual-test-checklist.md
│   └── audit/
├── devlog/                        # 每日开发日志（按日期组织）
├── .github/
│   └── workflows/backend-test.yml # CI 跑测试
├── RUNBOOK.md                     # 运维 runbook
└── README.md
```

## 常用命令

```bash
# 后端
cd backend
npm test                          # 114 用例
npm run db:init                   # 重置 schema + seed
node scripts/smoke-e2e.js         # 11 项接口 smoke
node scripts/smoke-userflow.js    # 6 项端到端 user flow smoke

# 服务器运维（需要 SSH key）
ssh ubuntu@43.139.176.199
pm2 logs resume-app-backend       # 查看日志
pm2 restart resume-app-backend --update-env
ls /var/backups/resume-app/       # 查看自动备份
cat /var/log/resume-app-backup.log

# 微信小程序
# IDE 中：工具 → 上传 → 体验版 → mp.weixin.qq.com 后台 → 提交审核
```

## 关键环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `DB_*` | ✅ | MySQL（host/port/user/password/name）|
| `REDIS_*` | ✅ | Redis（host/port/password?）|
| `JWT_SECRET` | ✅ | JWT 签名密钥，prod 用强随机 |
| `DEEPSEEK_API_KEY` | ✅ | DeepSeek LLM，用于 resume generate / match rerank |
| `DEEPSEEK_BASE_URL` | — | 默认 `https://api.deepseek.com/v1` |
| `WX_APPID` / `WX_SECRET` | ✅ | 微信小程序 code2session |
| `PORT` | — | 默认 3003 |
| `LOG_LEVEL` | — | `info` / `warn` / `error` / `debug` |

> ⚠️ 不要 commit `.env` — gitignored。`.env.example` 是模板。

## 重要安全点

- ✅ JWT_SECRET 每环境独立
- ✅ DeepSeek API key 不在 chat / log 中输出（红 mask + redact）
- ✅ 业务账号 MySQL（仅 SELECT/INSERT/UPDATE/DELETE，不 DDL）
- ✅ HTTPS via Let's Encrypt / Cloudflare / 自签（开发）
- ✅ HSTS + CSP + X-Frame-Options（Nginx）
- ✅ /api/auth/login IP 限流（10/min）
- ✅ 每日 mysqldump + 7 天 retention（cron 03:00）

## 测试覆盖

```bash
cd backend && npm test -- --test-concurrency=1
# ℹ tests 114
# ℹ pass 114
# ℹ fail 0
# real ~10s
```

覆盖：service（matchService/matchPrompt/resumeGenerator/jobFilter/rateLimit）、route（auth/resume/match/admin/legal）、middleware（auth/adminAuth/validate-resume）、util（logger redact）。

## 状态（截至 2026-06-30）

| 维度 | 状态 |
|------|------|
| npm test | ✅ 114/114 × 5 runs 绿 |
| e2e smoke | ✅ 11/11 critical |
| 真机 (serveo tunnel) | ✅ 体验版可扫码 |
| 微信审核 | 🟡 材料已就位，待提交 |
| ICP 备案 | ⏸️ 14-30 天（用户体验版可选）|

## 联系方式

- 仓库：https://github.com/CRLCRL00/resume-app
- 微信小程序 AppID: `wx3c0c93a02f5d2356`
- 服务部署：43.139.176.199:443（serveo.net tunnel）
