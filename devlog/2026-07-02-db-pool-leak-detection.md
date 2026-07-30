# DB Pool Leak Detection — 2026-07-02

## 目标

mysql2 pool 加 leak 检测 + idle 清理 + 慢查询 warn。

## 改动详情

`backend/src/config/db.js`：

- pool options 新增：
  - `enableKeepAlive: true`
  - `keepAliveInitialDelay: 10000`
  - `idleTimeout: 60000` (60s idle 后关闭)
  - `maxIdle: $DB_MAX_IDLE` (默认 5)
- `pool.query` 包 wrapper：
  - 记录 start time
  - 成功：`durationMs > DB_SLOW_QUERY_MS` (默认 1000ms) → `logger.warn({sql, params, durationMs}, 'db slow query')`
  - 失败：`logger.error({sql, params, durationMs, err}, 'db query failed')` 再 throw
- 心跳 setInterval 30s 输出 pool 状态：
  - `dbPoolAll` / `dbPoolFree` / `dbPoolUsed` / `dbPoolQueue`
  - `.unref()` 不阻塞进程退出
  - test env 跳过

`backend/.env.example` 加：
```
DB_POOL_SIZE=10
DB_MAX_IDLE=5
DB_SLOW_QUERY_MS=1000
```

`backend/tests/dbPool.test.js`（新，4 测）：
- pool exports `query` + `getConnection`
- `SELECT 1` 返 rows[0].n === 1
- 3 并发 query < 5s
- `SELECT SLEEP(0.1)` wrapper 不抛

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 199 | 196 | 2 | 1 |
| 2 | 199 | 196 | 2 | 1 |
| 3 | 199 | 196 | 2 | 1 |

baseline 192 → 196（+4 dbPool tests）。2 fail pre-existing（authLockout state pollution）。

## 旁路工作

启本机 Redis 测试时发现 `backend/.env` 设 `REDIS_PASSWORD=`（空），需 Redis 无 auth。检查时 Redis 是用 `--requirepass ResumeRedis@2026` 启的，导致 `NOAUTH Authentication required` 29 fail 假象。重启 Redis 不带 auth 后正常。

⚠️ 注意 prod server 的 Redis 是带 password 的（`REDIS_PASSWORD=ResumeRedis@2026`），test env 故意空 password。两者不可混。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | idleTimeout 60s | 默认 mysql2 无 idle timeout；stale conn 长期占位 |
| 2 | slow query threshold 1000ms | prod 经验值；与现有 `slow_operations_total` metric 一致 |
| 3 | wrapper 保留 throw | 调用方 catch 行为不变 |
| 4 | heartbeat 30s | 比 health endpoint（实时）低频；只做 debug 用 |

## 风险

| 风险 | 缓解 |
|------|------|
| 慢查询 log 体积大 | 只 warn >1000ms；正常 query 不打 |
| maxIdle=5 在高并发下不够 | env 可调 `DB_MAX_IDLE=20` |
| idleTimeout 过短断连接 | 60s 较保守；keepalive 10s 防误断 |

## Commits

| SHA | msg |
|-----|-----|
| `a228063` | feat(db): pool leak 检测 + idle 清理 + 慢查询 warn |