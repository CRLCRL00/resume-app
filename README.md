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
| [https://crlcrl00.github.io/resume-app/](https://crlcrl00.github.io/resume-app/) | **文档站点**（VitePress，main 自动部署） |
| [docs/index.md](./docs/index.md) | 仓库内文档索引 |
| [RUNBOOK.md](./RUNBOOK.md) | 运维 / 部署 / 故障排查 |
| [docs/audit/微信管理后台操作手册.md](./docs/audit/微信管理后台操作手册.md) | 微信小程序后台手动操作 |

### 本地预览文档站

```bash
npm run docs:dev        # http://localhost:5173
npm run docs:build      # 产出 docs-site/.vitepress/dist
```

## 文档

> 项目文档已迁到独立 VitePress 站点 [crlcrl00.github.io/resume-app](https://crlcrl00.github.io/resume-app/)。

包含：

- **指南** — 快速开始 / 架构
- **运维** — perf-bench / smoke-test / 告警 / 慢查询 / 审计 / 2FA / 混沌
- **参考** — OpenAPI / 环境变量
- **更新日志** — 全部 devlog 索引

旧 `docs/*.md` 保留为仓库内简版（向后兼容）。

### 部署

- 触发：push 到 `main`，涉及 `docs-site/**` 或本 workflow 文件
- 也可手动：Actions → docs-deploy → Run workflow
- Workflow：`.github/workflows/docs-deploy.yml`
- 输出：GitHub Pages 环境 `github-pages`
- 当前 URL：<https://crlcrl00.github.io/resume-app/>

### 自定义域名

支持挂自有域名（部署在域名根路径）。启用步骤见
[docs-site/operations/custom-domain.md](./docs-site/operations/custom-domain.md)：

- 改 `docs-site/CNAME` 为真实域名（仓库内为占位 `docs.example.com`，勿提交真域名）
- repo → Settings → Pages 填 Custom domain + 勾选 Enforce HTTPS
- DNS：CNAME `docs` → `crlcrl00.github.io`


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
│   ├── workflows/backend-test.yml      # CI 跑测试
│   ├── workflows/deploy.yml            # 后端 SSH 部署
│   └── workflows/upload-miniprogram.yml # 体验版上传 (miniprogram-ci)
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
# CI 自动上传：git push 到 develop（见下方 Mini-Program Auto-Upload）
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

## Deploy

服务器无 SSH key 访问 origin → 用 GH Actions 打包 → SCP 上传 → 服务器解压重启。

### GH Actions 流程
1. Repo → Settings → Secrets → Actions 新增：
   - `SERVER_HOST`（e.g. `43.139.176.199`）
   - `SERVER_USER`（e.g. `ubuntu`）
   - `SERVER_SSH_KEY`（对应 `~/.ssh/authorized_keys` 的私钥）
2. GitHub → Actions → Deploy → Run workflow → 选 ref
3. 流水线：tar backend（排除 node_modules/.env/logs/tests）→ artifact → SCP → 服务器跑 `scripts/deploy.sh` → pm2 reload → `/api/health` smoke

### 手动
```bash
# 本地打包
tar --exclude='node_modules' --exclude='.env' --exclude='*.log' \
    --exclude='tests' --exclude='coverage' \
    -czf /tmp/release.tar.gz backend/
scp /tmp/release.tar.gz ubuntu@43.139.176.199:/tmp/

# 服务器执行
bash /opt/resume-app/backend/scripts/deploy.sh /tmp/release.tar.gz
```

### Mini-Program Auto-Upload

体验版上传通过 `.github/workflows/upload-miniprogram.yml` 自动完成（基于 `miniprogram-ci`）。

**触发条件**

- 自动：`push` 到 `develop` 且变更涉及 `mini-program/**` 或本 workflow 文件本身（`paths` 过滤避免无关提交触发）
- 手动：GH UI → Actions → "Upload Mini-Program" → Run workflow（可填 `version` / `desc` 两个 input）

**流水线**

1. checkout → `actions/setup-node@v4` (Node 20, npm cache from `mini-program/package-lock.json`)
2. `npm ci` 安装 `miniprogram-ci`（已是 mini-program 的 devDep）
3. 从 `secrets.WX_MINIPROGRAM_KEY_BASE64` 解 base64 出 `D:\小程序密钥.key` 到 `/tmp/wx_private.key`
4. `npx miniprogram-ci upload --pp ./ --pkp /tmp/wx_private.key --appid wx3c0c93a02f5d2356 --uv "$VERSION" --udata "$DESC"`
5. `if: always()` 清理密钥文件
6. `if: success()` 写 $GITHUB_STEP_SUMMARY

**版本号规则**

- 手动触发：用 workflow_dispatch 输入的 `version`（默认 `1.0.0`）
- 自动触发：`format('1.0.{0}', github.run_number)` —— 每次 push 递增
- desc 同理：`GH Actions auto upload #<run_number>`

**前置 GH Secret**

| Secret | 来源 | 说明 |
|--------|------|------|
| `WX_MINIPROGRAM_KEY_BASE64` | `D:\小程序密钥.key` 的 base64 编码 | 微信小程序代码上传私钥（**绝不入仓**）|

**设置命令**（Git Bash / WSL）

```bash
# GitHub CLI 会自动 base64 编码（注意 -w 0 去掉换行）
base64 -w 0 "D:/小程序密钥.key" | gh secret set WX_MINIPROGRAM_KEY_BASE64 -

# 或者 process substitution
gh secret set WX_MINIPROGRAM_KEY_BASE64 < <(base64 -w 0 "D:/小程序密钥.key")

# PowerShell 用户
[Convert]::ToBase64String([IO.File]::ReadAllBytes('D:\小程序密钥.key')) | gh secret set WX_MINIPROGRAM_KEY_BASE64 -
```

**安全注意**

- 密钥仅在 runner 临时目录 `/tmp/wx_private.key` 存在；`if: always()` step 保证上传成功/失败都 `rm -f`
- 任何 step 都不应 `echo` 密钥内容；`secrets.*` 在 log 中默认被 mask
- 如怀疑泄露：在 mp.weixin.qq.com → 开发管理 → 开发设置 → 重置「小程序代码上传」密钥

### 回滚
服务器 `.deploy-backup/<ts>/` 保留最近 5 个版本：
```bash
cd /opt/resume-app/backend
cp -p .deploy-backup/<previous-ts>/package.json .
cp -pR .deploy-backup/<previous-ts>/src .
pm2 reload resume-app-backend
```

> ⚠️ Windows 下 `git update-index --chmod=+x` 可能不持久，服务器上用 `bash scripts/deploy.sh` 显式调用即可。

### Smoke test

每次部署后跑一次端点存活探测（不依赖 shell，纯 Node 20+，Windows / Linux 通用）：

```bash
# 默认指向 serveo 生产 tunnel
pnpm smoke                     # 或 npm run smoke
npm run smoke:prod             # 等价，显式语义

# 自定义目标（本地 / 预发）
BASE_URL=http://localhost:3000 npm run smoke
BASE_URL=https://staging.example.com ALERT_TOKEN=xxx npm run smoke

# 帮助
npm run smoke:help             # 或 node scripts/smoke.js --help
```

详见 [docs/smoke-test.md](./docs/smoke-test.md)。
