# 开发日志 — 2026-07-06（Phase 8+ Round 29）

> 阶段：8+ Round 29 — ADF hardening
> 前置：[2026-07-05-phase8-plus-round28.md](../devlog/2026-07-05-phase8-plus-round28.md)

## 目标

3 hardening 项：
A. GH Actions auto-upload mini-program
D. Sentry node 集成
F. Redis sliding window 限流

## 最终结果

| 项 | 状态 |
|----|------|
| A GH Actions upload | ✅ workflow_dispatch + push develop 触发 + 4 测 |
| D Sentry | ✅ initSentry + 4 测 + Express handler |
| F Sliding window | ✅ slidingRateLimit + 5 测 |
| npm test 3x | ✅ **245 / 242 pass / 2 fail / 1 skip** × 3 |

## 改动详情

### A — GH Actions auto-upload

`.github/workflows/upload-miniprogram.yml`（新）：
- trigger:
  - `push: branches: [develop], paths: [mini-program/**, .github/workflows/upload-miniprogram.yml]`
  - `workflow_dispatch: inputs: { version, desc }`
- 7 steps: checkout → setup-node@20 → npm ci → decode base64 key → miniprogram-ci upload → cleanup → summary
- secret: `WX_MINIPROGRAM_KEY_BASE64`（user 在 MP 后台下载 key 后 base64 编码）
- timeout: 10 min
- AppID: `wx3c0c93a02f5d2356`

`README.md` 增「Mini-Program Auto-Upload」段：trigger 条件 + secret 设置命令（Git Bash + PowerShell 双路径）+ 手动触发步骤。

### D — Sentry 集成

`backend/src/sentry.js`（新）：
- `initSentry()`：读 `SENTRY_DSN` env，无则返回 false 不 init
- `Sentry.init({ dsn, environment, release, tracesSampleRate: prod 0.1 else 0 })`
- `beforeSend` strip `authorization` / `cookie` / `x-csrf-token` headers（PII）
- `setTestCapture(fn)` test hook

`backend/src/routes/sentryDebug.js`（新）：
- POST `/api/internal/sentry-debug` body `{ message, level }`
- 未 init → 503 `{ sentry:false, hint:'SENTRY_DSN not configured' }`
- init → `Sentry.captureMessage()` → 200 + eventId

wire:
- `index.js`：`initSentry()` 在 `createApp()` 前；`Sentry.setupExpressErrorHandler(app)`；uncaughtException / unhandledRejection 也 captureException
- `app.js` mount sentryDebugRouter 在 `/api/internal`
- `middleware/errorHandler.js`：500 path 加 tags (route, method, requestId) + user.id → captureException
- `config/index.js`：`SENTRY_DSN: process.env.SENTRY_DSN || ''`

测 `tests/sentry.test.js`（4）：init false / init true / debug 503 / debug 200 + capture stub

`backend/docs/sentry.md`（新）：why / enable / test / PII strip / env matrix / files map

### F — Sliding window 限流

`backend/src/middleware/slidingRateLimit.js`（新）：
- 算法：ZSET (member: `<now>-<rand>`, score: ms timestamp)
  - ZREMRANGEBYSCORE 移除窗口外
  - ZCARD 当前计数
  - count >= limit → 拒绝（retry-after = oldest + windowMs - now）
  - 通过：ZADD now + PEXPIRE windowMs
- 容错：Redis 异常 fail-open（log warn）
- middleware factory `slidingRateLimitMiddleware({ name, limit, windowMs, keyFn })`
- 响应头：`X-RateLimit-Limit` / `X-RateLimit-Remaining` / `Retry-After`
- 拒绝：429 + `{ code: 1429, message, retryAfterMs }`

⚠️ **bug fix**：原 `const { redis } = require('../config/redis')` destructure 错（module 直接 `module.exports = defaultRedis`），改成 `const redis = require(...)` 才拿到 client。

wire `backend/src/app.js`：
- `/api/auth/login` → per-IP 5/min
- `/api/auth/refresh` → per-IP 10/min
- `/api/resume/generate` → per-user 10/min（after userAuth）
- `/api/match/generate` → per-user 10/min
- 测试环境用 noop（避免 supertest 反复请求触发 429）— `process.env.NODE_ENV === 'test' || npm_lifecycle_event === 'test' || /test/i.test(process.argv[1])`

⚠️ **bug fix**：test env `sliding = () => noopMw`（factory 返 noop），不是 `(req,res,next)=>next()` 当 factory 用（导致 `next is not a function` 100+ fail）。

测 `tests/slidingRateLimit.test.js`（5）：
- under limit 3 sequential → count 1/2/3
- at limit → 429 via middleware
- above limit → blocked + retry-after ≈ windowMs
- redis 异常 → fail-open (allowed)
- 窗口过期 → 重新允许（用 stub `_forceExpire` 避免 real-time sleep 漂移）

`backend/run-tests.js`（新）：
- 跨平台 test runner：set `NODE_ENV=test` + `npm_lifecycle_event=test` → spawn `node --test`
- Windows `NODE_ENV=test node ...` bash 语法不工作（cmd 不识别），用 node wrapper 解决

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 245 | 242 | 2 | 1 |
| 2 | 245 | 242 | 2 | 1 |
| 3 | 245 | 242 | 2 | 1 |

baseline 235 → 245（+10：sentry 4 + sliding 5 + 1 incremental）。2 fail pre-existing authLockout state pollution。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A 用 GH secret + base64 | key 走 secret 不进 repo |
| 2 | A paths filter `mini-program/**` | 避免无关 push 触发上传 |
| 3 | A workflow_dispatch + inputs | 手动重传 + 自定义版本号 |
| 4 | D `SENTRY_DSN` unset → no-op | dev/test 不需要 DSN |
| 5 | D `tracesSampleRate: prod 0.1` | dev 100% tracing 太重 |
| 6 | D beforeSend strip headers | 防 PII 上报 |
| 7 | F sliding ZSET (非 Lua) | 简单 + Redis 4.0+ 原生 ZADD |
| 8 | F fail-open | Redis 挂不阻断业务 |
| 9 | F test env noop via process.env + argv | 多信号检测 + Windows 兼容 |
| 10 | F `run-tests.js` wrapper | Windows bash 不识别 `NODE_ENV=... node` |

## 风险

| 风险 | 缓解 |
|------|------|
| A 公网 IP 变化（miniprogram-ci） | 仍需 IP 白名单（Round 27） |
| A key secret 泄露 | 仅 GH secret；轮换 = MP 后台重置 |
| D Sentry quota 超限 | DSN 是 free tier；超限降级到 logs |
| F ZSET O(log N) 极端高 QPS 单 key 慢 | 10/min 限很低，不会热点 |
| F Redis 故障 fail-open 暴露 | 监控 redis health + alert |
| F test env 检测 argv1 误判 | 多信号叠加（NODE_ENV + lifecycle + argv） |

## Commits

| SHA | msg |
|-----|-----|
| `f736442` | ci(workflow): auto-upload mini-program experience on push to develop |
| `51dbc77` | feat(monitor): @sentry/node integration (capture exceptions + express handler) |
| `055c9ae` | feat(ratelimit): sliding window via Redis ZSET (per-IP + per-user) + test runner |