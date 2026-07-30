# 开发日志 — 2026-07-05（Phase 8+ Round 28）

> 阶段：8+ Round 28 — ADF hardening
> 前置：[2026-07-05-phase8-plus-round27.md](../devlog/2026-07-05-phase8-plus-round27.md)

## 目标

3 hardening 项：
A. 后端 graceful shutdown
D. 前端 wx.onError + client_errors 表
F. Redis AOF+RDB 持久化检查

## 最终结果

| 项 | 状态 |
|----|------|
| A graceful shutdown | ✅ lifecycle.js + 7 测全过 |
| D client_errors | ✅ migration + route + 4 测 + mini-program monitor.js |
| F Redis 持久化 | ✅ redisCheck + health 扩展 + 5 测 + docs |
| npm test 3x | ✅ **235 / 232 pass / 2 fail / 1 skip** × 3 |

## 改动详情

### A — Graceful shutdown

`backend/src/lifecycle.js`（新）：
- `setupGracefulShutdown(server, { logger, db, redis, timeoutMs, onShutdownStart })`:
  - 注册 SIGTERM + SIGINT 处理器
  - 第一次信号：log → `onShutdownStart` 回调 → `server.close()` 等 in-flight drain
  - 关 DB pool（`pool.end()`）+ Redis（`redis.quit()`）并行
  - Hard timeout（默认 10s，prod 设 30s）强制 `process.exit(1)`
  - 第二次信号立即 `process.exit(1)`
  - 正常关闭不显式 `process.exit(0)` — 让 event loop 自然耗尽（测试需要）
  - 返回 `cleanup()` 函数移除监听器

wire `backend/src/index.js`：
- 替换原 inline `shutdown()` 为 `setupGracefulShutdown(server, { logger, db: pool, redis, timeoutMs: 30000, onShutdownStart: () => isShuttingDown = true })`
- middleware `app.use((req, res) => if (isShuttingDown) 503)` 拒新请求

测 `tests/lifecycle.test.js`（7）：
- 注册 SIGTERM+SIGINT handler
- 触发信号后 server.close + log 「http server closed」
- 第二次信号 process.exit(1)
- in-flight 完成才 fire close callback
- stuck server hard timeout exit(1)
- cleanup() 移除监听器
- imports 健全

### D — 前端错误监控

`backend/migrations/028-client-errors`（用 `backend/src/db/schema.sql` + `schema_migrations` 增量）：
```sql
CREATE TABLE client_errors (
  id BIGINT UNSIGNED PK AUTO_INCREMENT,
  openid VARCHAR(64) DEFAULT NULL,
  appid VARCHAR(64) DEFAULT 'wx3c0c93a02f5d2356',
  version VARCHAR(32) DEFAULT NULL,
  platform VARCHAR(32) DEFAULT NULL,
  error_type VARCHAR(64) DEFAULT NULL,
  message TEXT,
  stack TEXT,
  url VARCHAR(512) DEFAULT NULL,
  metadata JSON DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_openid_created (openid, created_at),
  KEY idx_type_created (error_type, created_at),
  KEY idx_appid_version (appid, version, created_at)
);
```

`backend/src/routes/clientErrors.js`（新）：
- POST `/api/internal/client-errors`
- Joi validate: errorType ∈ {app_onerror, wx_onerror, request_fail, unhandled_rejection}，message max 4KB，stack max 32KB
- Insert row → `{ code: 0, data: { id } }`

测 `tests/clientErrors.test.js`（4）：valid / missing errorType / missing message / oversized stack

`mini-program/utils/monitor.js`（新）：
- `reportClientError(type, err, extra)` → raw `wx.request` POST 到 backend（不绕 utils/request 防递归）
- `wx.getSystemInfoSync().platform` + `wx.getAccountInfoSync().miniProgram.version` + storage openid

wire `mini-program/app.js`：
- `require('./utils/monitor')`
- `App.onError(err => reportClientError('app_onerror', err))`
- `wx.onError(err => reportClientError('wx_onerror', err))`
- `wx.onUnhandledRejection(res => reportClientError('unhandled_rejection', res.reason))`

wire `mini-program/utils/request.js`：
- `doRequest` fail 回调 → `reportClientError('request_fail', err, { url, statusCode })`

⚠️ spec 写 `appid wx3c0c93a02f5d2356` 但 `.env` 是 `wx317478190d056fb0`，DB 列 DEFAULT 用 spec 值；前端 `appid` 不传，让 DB DEFAULT 兜底。

### F — Redis 持久化

`backend/src/db/redisCheck.js`（新）：
- `checkRedisPersistence(redis)` → `{ ok, warnings, persistence: { aof, rdb }, info: {...} }`
- 用 `redis.call('CONFIG', 'GET', ...)` 查 appendonly / save
- INFO persistence 取 aof_enabled / rdb_last_bgsave_status
- AOF off / RDB empty → warnings[]

wire `backend/src/db/diagnose.js`：
- DB check 后调 `checkRedisPersistence(redis)`
- test env skip

wire `backend/src/routes/health.js`：
- 加 `data.redis.persistence: { aof, rdb }`（启动时缓存，CONFIG GET 失败回 'unknown'）

测 `tests/redisPersistence.test.js`（5）：stub redis
- AOF on + RDB set → ok
- AOF off → aof_off warning
- RDB empty → rdb_off warning
- both off → 2 warnings
- throw → graceful warn

`backend/docs/redis-persistence.md`（新）：
- 推荐 `redis.conf`：`appendonly yes` + `appendfsync everysec` + `save 900 1 / 300 10 / 60 10000`
- 热迁移命令：`CONFIG SET appendonly yes` + `CONFIG SET save "..."`
- 故障排查表

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 235 | 232 | 2 | 1 |
| 2 | 235 | 232 | 2 | 1 |
| 3 | 235 | 232 | 2 | 1 |

baseline 218 → 235（+17：lifecycle 7 + clientErrors 4 + redisPersistence 5 + 1）。2 fail pre-existing authLockout state pollution。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A 正常关闭不显式 exit(0) | 测试要 process 存活；event loop 自然耗尽退出 |
| 2 | A timeoutMs 30s prod / 10s 测试默认 | prod in-flight 长尾；测试快速验证 |
| 3 | A `onShutdownStart` 回调 | 让 app.js middleware 同步翻转 `isShuttingDown` |
| 4 | D schema.sql 增量而非独立 migration 文件 | repo 当前约定（004/005/028 都 append 到 schema.sql） |
| 5 | D 错误报告用 raw `wx.request` 不绕 utils | 防递归死循环 |
| 6 | D appid DEFAULT 用 spec 值 | DB 列兜底；前端不传 |
| 7 | F CONFIG GET 失败回 'unknown' | 托管 Redis（如 AWS ElastiCache）禁用 CONFIG 时优雅降级 |

## 风险

| 风险 | 缓解 |
|------|------|
| A `isShuttingDown` race（middleware 翻 vs handler 翻） | `onShutdownStart` 同步回调先翻 |
| A hard timeout 太短 | 30s 给长尾 in-flight 留空间 |
| D monitor wx.request 自身失败 | `fail: () => {}` 静默，永不抛 |
| D client_errors 表暴涨 | 后续加 7-day TTL cleanup cron |
| F CONFIG GET 在某些 Redis 配置禁用 | fallback 'unknown' + warning |

## Commits

| SHA | msg |
|-----|-----|
| `c4af930` | feat(redis): AOF+RDB persistence check + health extension + docs |
| `caf107a` | feat(monitor): client_errors table + wx.onError reporter |
| `5b0ea7b` | feat(server): graceful shutdown (SIGTERM drain + pool/redis close) |