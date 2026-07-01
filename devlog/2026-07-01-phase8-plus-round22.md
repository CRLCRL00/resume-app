# 开发日志 — 2026-07-01（Phase 8+ Round 22）

> 阶段：8+ Round 22
> 前置：[2026-07-01-server-deploy-round18-21.md](../devlog/2026-07-01-server-deploy-round18-21.md)

## 目标

3 个 hardening 项：
A. pino log serializer 修 + 移除 winston
B. server 端 deploy 脚本 + GH Actions workflow
C. /api/health 加 uptime / version / db / redis

## 最终结果

| 项 | 状态 |
|----|------|
| A pino + 去 winston | ✅ serializers + pino-pretty 13.1.3 + 2 测 |
| B deploy 脚本 + workflow | ✅ deploy.sh (bash -n OK) + .github/workflows/deploy.yml + 文档 |
| C health enrich | ✅ status/uptime/nodeVersion/db/redis + 4 测（live/ready/404/enriched） |
| npm test 3x | ✅ 192 pass / 2 pre-exist fail / 1 skip × 3 稳 |

## 改动详情

### A — Pino + winston 移除

依赖：
- 装 `pino-pretty@^13.1.3` (devDep)
- 卸 `winston@^3.13.0`

`backend/src/utils/logger.js`：
- serializers: `req`（method/url/remoteAddress/UA）/ `res`（statusCode）/ `err`（type/message/stack）
- 规则：prod = JSON line / dev = pino-pretty（colorize + 时间 HH:MM:ss.l） / test = silent
- mixin 从 `getRequestId()` 注入 `requestId`（Round 19 接续）
- `LOG_PRETTY=false` env 关 pretty

`backend/src/app.js`：pinoHttp 实例化加 serializers，确保 req/res 不被原样 stringify 成 `[object Object]`。

`backend/tests/pinoLogger.test.js`：函数导出 + 不抛异常 + 字段存在。

deviation: working tree 上有 3 个 pre-existing 修改（含 `src/index.js` 上 Round 21 revert 后的残留 spawnSync 代码）— 全 discard，dirty tree clean → 测试基线干净。

### B — Deploy 脚本 + GH workflow

`backend/scripts/deploy.sh`（POSIX bash，`bash -n` OK）：
- 入参 `DEPLOY_TARBALL`（默认 `/tmp/...tar.gz`）+ env `DEPLOY_ROOT`（默认 `/opt/resume-app`）+ `PM2_NAME`（默认 `resume-app-backend`）
- 流程：备份 files → 解 tarball → `npm ci --omit=dev`（fallback `npm install`） → `pm2 reload` fallback `restart` → smoke `/api/health` → 留 5 个最近备份
- Windows git 上 `chmod +x` 不生效，README 注明 `bash scripts/deploy.sh` 显式调用

`.github/workflows/deploy.yml`：
- `workflow_dispatch` 触发，input ref
- Job1 `package`：ubuntu-latest，tar exclude node_modules/.env/.log/tests/coverage → `actions/upload-artifact@v4`
- Job2 `deploy`：download artifact → `appleboy/scp-action` 上传 → `appleboy/ssh-action` 跑 deploy.sh
- secrets 需 `SERVER_HOST` / `SERVER_USER` / `SERVER_SSH_KEY`

`backend/scripts/README.md`：manual 步骤 + rollback 用 `.deploy-backup/<ts>/`。

`README.md`：Deploy 节 + workflow 行。

### C — Health enrich

`backend/src/routes/health.js`（重写）：
- `GET /api/health` → `{ code, data: { status, env, version, uptime, nodeVersion, pid, hostname, db:{ok,latencyMs,error?}, redis:{...} } }`；503 if db/redis 不通
- `GET /api/health/live` → `{ code:0, data:{status:'live', uptime} }`（k8s liveness 永远 200）
- `GET /api/health/ready` → `{ code:0|503, data:{status:'ready'|'not_ready', db, redis} }`（k8s readiness）

冷启 ping 延迟：Redis 13ms / DB 218ms（mysql2 handshake）。

deviation: 原 `/api/health/deep` 端点被替换（数据合并进 `/` 的 `data.db` / `data.redis`）；保留 live + ready 的 flat shape 兼容旧 `healthLiveness.test.js`。

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 195 | 192 | 2 | 1 |
| 2 | 195 | 192 | 2 | 1 |
| 3 | 195 | 192 | 2 | 1 |

baseline 188 → 192（+4 测：pinoLogger 2 + health 2）。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A pino-pretty dev-only | prod log 走 stdout JSON 给 log shipper |
| 2 | A 工作树 residue 全部 discard | 不属本轮 scope |
| 3 | B deploy.sh POSIX bash 而非 npm script | server 上 run；本地也能手跑 |
| 4 | B GH action SCP + SSH 步骤 | 走 secrets，不 server-side `git fetch` |
| 5 | C health 503 if degraded | 503 让 LB / k8s probe 自动 fail |
| 6 | C 替换 /api/health/deep | 新 `/` 包含 deep 信息 |

## 风险

| 风险 | 缓解 |
|------|------|
| A pino-pretty devDep 误装到 prod | npm prune --production 自动清 |
| B GH secrets 缺失 | README 列；workflow 会 fail-fast 报 |
| B deploy.sh 在 server 上 cwd | 用 `DEPLOY_ROOT` env 兜底 |
| C 503 时 k8s LB 摘流 | 正是预期；可用 `200` 当 data.status='degraded' |

## Commits

| SHA | msg |
|-----|-----|
| c1d4d48 | feat(ops): server deploy 脚本 + GH Actions workflow |
| fb4bfdb | feat(observability): pino log serializer 修复 + 移除 winston |
| 98b9372 | feat(observability): /api/health 加 up/env/version/nodeVersion/db/redis |
