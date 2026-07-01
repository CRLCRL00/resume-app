# 开发日志 — 2026-07-01（Phase 8+ Round 19）

> 阶段：8+ Round 19
> 前置：[2026-07-01-phase8-plus-round18.md](../devlog/2026-07-01-phase8-plus-round18.md)

## 目标

3 个 hardening 项：
A. logger 结构化（pino）+ request id
B. `/api/internal/metrics/summary` JSON
C. `/api/admin/*` audit trail

## 最终结果

| 项 | 状态 |
|----|------|
| A pino + request id | ✅ AsyncLocalStorage + mixin + 2 测 |
| B metrics summary | ✅ JSON + 1 测 |
| C admin audit | ✅ admin_audit 表 + middleware + 1 测 |
| npm test 3x | ✅ 168 pass / 1 skip × 3 稳（165 → 169）|

## 改动详情

### A — pino + request id

依赖安装：
- `pino@9.14.0`
- `pino-http@10.5.0`
- `uuid@10.0.0`

`backend/src/middleware/requestContext.js`（新）：
- AsyncLocalStorage 单例 + `requestContextMiddleware`
- 读 `x-request-id` 或 `randomUUID()`
- 写回 res header，注入 `req.requestId`
- 导出 `getRequestId()` / `getContext()` / `storage`

`backend/src/utils/logger.js`（新）：
- pino 实例，level 走 env；test env `silent`
- `mixin()` 从 getRequestId 注入 `requestId`
- 服务名 `service: 'resume-app'` base

mount 顺序（关键）：`requestContext → pinoHttp → helmet → cors → rawBody → json → metrics → routes`。metrics 的 histogram 不受影响，pino-http log 行带 requestId。

deviation: 旧 logger 是 winston（subagent 隐式替换为 pino，redact 通过 pino `redact` option 保留路径/敏感字段）。

### B — metrics summary JSON

`backend/src/routes/metrics.js` 加路由 `/metrics/summary`：
- 读 Counter/Gauge 经 `getCounterMap` / `getGaugeMap`
- labels → JSON-stringified key，value 聚合
- 响应：`{ generatedAt, counters: {httpRequests, slowOps, llmCalls, llmTokens}, gauges: {dbPoolConnections} }`
- 不需 prom scraper，运维直接 GET

test `tests/metricsSummary.test.js` 复用 `tests/health.test.js` 模式：`createApp()` + supertest + status 200 + `data.generatedAt` 存在。

### C — admin audit trail

`backend/src/db/migrations/004-admin-audit.sql`（新）+ `db/004-admin-audit.sql` + `schema.sql` 末尾 INSERT IGNORE + 同表 CREATE。

`backend/src/middleware/adminAudit.js`（新）：
- 在 `/api/admin` mount 前挂
- `res.on('finish')` 异步 INSERT；失败静默（不影响响应）
- 字段：openid / action / target_type+id / method / path / ip / status / request_id

实际与 spec 偏差：`adminAuth` 写 `req.user.openid`（非 `req.openid`），middleware 双兼容 `req.openid || req.user?.openid`。

测试 seed 自己的 openid `admin_audit_test_openid`（无现存 `test_admin_openid`，最近邻 `admin_phase4_test` from `admin-jobs-crud.test.js:10`）。首次跑前需 `node scripts/db-init.js` 让表落库。

## npm test

| Run | pass | fail | skip | tests |
|-----|------|------|------|-------|
| 1 | 168 | 0 | 1 | 169 |
| 2 | 168 | 0 | 1 | 169 |
| 3 | 168 | 0 | 1 | 169 |

baseline 164 → 168（+4 测试 / +2 pino+ctx / +1 summary / +1 audit；首次运行后 adminJobsCrud 历史 fail -5 → 转 pass）。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A pino 在 helmet 之前 | 任何 panic/error 也要打日志 |
| 2 | A test env logger silent | 不污染 stdout + 测试 runner |
| 3 | B JSON 用 stringified label key | 简单等价表示；保持 route 简洁 |
| 4 | C res.on finish 内 INSERT 静默 | 不让日志写入拖慢或破坏响应 |
| 5 | C adminAudit 双读 openid | middleware 解耦 req.user vs req.openid |

## 风险

| 风险 | 缓解 |
|------|------|
| A pino-http 默认 log 大量请求淹没日志 | LOG_LEVEL=info；slowOps 已独立 metric |
| B label 字符串键可能重复但不同 labels | 当前 Counter label set 固定（method/route/status 等）；无歧义 |
| C admin_audit 表无清理 | 月度 cron 后期再加（参考 003-audit-archive）|

## Commits

| SHA | msg |
|-----|-----|
| 24b5d44 | feat(observability): pino logger + request id (AsyncLocalStorage) |
| 9ddb711 | feat(observability): metrics summary JSON endpoint |
| add893b | feat(audit): /api/admin/* 写操作入 admin_audit 表 |
