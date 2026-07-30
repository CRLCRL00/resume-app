# 开发日志 — 2026-07-07（Phase 8+ Round 36）

> 阶段：8+ Round 36 — ADF hardening
> 前置：[2026-07-07-phase8-plus-round35.md](../devlog/2026-07-07-phase8-plus-round35.md)

## 目标

3 hardening 项：
B. 慢查询告警接入 metricsAlerts
C. Admin 操作 audit log 过滤增强 + 保留 cron
H. 性能 CI gate（PR-only p99 < 1500ms）

## 最终结果

| 项 | 状态 |
|----|------|
| B SlowQuerySpike alert | ✅ 8 rules + 4 测 |
| C audit log filter | ✅ 6 维过滤 + 2 distinct 端点 + retention cron + 14 测 |
| H perf CI gate | ✅ perf-ci.yml + p95/p99 阈值 + 5 测 |
| **npm test 3x** | ✅ **338 / 335 pass / 2 fail / 1 skip** × 3 |

baseline 316 → 338（+22：B 4 + C 14 + H 5 - 重叠）。2 fail pre-existing authLockout。

## 改动详情

### B — SlowQuerySpike Alert

`backend/src/routes/metricsAlerts.js`（扩）：
- THRESHOLDS 加 `slowQueries: Number(process.env.ALERT_SLOW_QUERY_THRESHOLD || 50)`
- RULES 加 `SlowQuerySpike` (severity: warning)
- evaluateRule 加 case：sumCounter 跨所有 `{operation, table}` label → `db_slow_queries_total`
- import `dbSlowQueries` from `metricsModule = require('./metrics')`

`infra/prometheus/alerts.yml`：
- 新规则 `SlowQuerySpike` rate-based：`(rate(db_slow_queries_total[5m]) > 0.5) for 5m`（与 in-process absolute counter 形成对照）

`backend/tests/metricsAlerts.test.js`（扩 4 测）：
- `/rules` count 7→8
- SlowQuerySpike 默认 threshold=50 不触发
- counter=51 触发
- env `ALERT_SLOW_QUERY_THRESHOLD=10` 生效

### C — Audit Log Filter + Retention

#### C-1: Schema 迁移
`backend/scripts/migration-005-audit-result.sql`：
```sql
ALTER TABLE admin_operation_logs
  ADD COLUMN `result` ENUM('success','failure','unknown') NOT NULL DEFAULT 'unknown' AFTER `detail`,
  ADD KEY `idx_result` (`result`),
  ADD KEY `idx_action_time` (`action`, `created_at`);
```
幂等 + dev DB 手动 apply + `schema.sql` 同步。

#### C-2: adminLog service 签名扩展
`backend/src/services/adminLog.js`：`record(adminOpenid, action, targetType, targetId, detail, ip, result='unknown')` — 新 result 参数 + ENUM 白名单 + INSERT 加列。**向后兼容**：旧调用方无 result 走 `'unknown'`。

#### C-3: 过滤 helper + 6 维过滤
`backend/src/routes/admin/logs.js`：
```js
function buildLogFilter({ action, admin_openid, target_id, target_type, result, ip, dateFrom, dateTo }) {
  // WHERE 条件 + 参数数组拼接
}
```
GET `/api/admin/logs` 读 query 参数 + apply 过滤。SELECT 加 `result` 列。

#### C-4: distinct 端点
- `GET /api/admin/logs/actions` — `SELECT action, COUNT(*) AS count FROM ... GROUP BY action ORDER BY count DESC LIMIT 100`
- `GET /api/admin/logs/actors` — `SELECT admin_openid, COUNT(*) AS count, MAX(created_at) AS last_at FROM ... GROUP BY admin_openid ... LIMIT 100`

#### C-5: 保留 cron
`backend/src/jobs/adminLogsCleanup.js`（new，mirror `clientErrorsCleanup.js`）：
- `runAdminLogsCleanup({pool, retentionDays=180, batchSize=1000, logger})`
- 循环 batch DELETE 直到 affected < batchSize
- min retention 30 防误删
- 幂等（二次 0 deletes）

`backend/src/index.js`：boot 5min 后首次 + 24h interval，`.unref()` + `isTestEnv` 短路。

#### C-6: OpenAPI 文档
4 条 entries 加（filter + actions + actors + retention-trigger）。

#### C-7: 14 tests
- `service-adminLog-result.test.js` (3): success / failure / default unknown
- `adminLogsCleanup.test.js` (5): retention=180 / 幂等 / retention=30 / batchSize=1 / group-by-action
- `route-admin-logs-filter.test.js` (6): action prefix / admin_openid / result / dateFrom / actions / actors

### H — Perf CI Gate

#### H-1: GitHub Actions workflow
`.github/workflows/perf-ci.yml`（new）：
- Trigger：`pull_request → [develop, main]`（**不** push，省 CI 分钟）
- Concurrency cancel-in-progress
- Timeout 5 min
- mysql:8 + redis:7 services（同 backend-ci.yml）
- Steps：checkout → setup-node@20 → npm ci → db-init → `BENCH_P99_MS=1500 BENCH_P95_MS=800 BENCH_DURATION=5000 npm run perf:bench` → upload-artifact on fail

#### H-2: Bench script 扩展
`backend/scripts/perf-bench.js`：
- 新 env `BENCH_P95_MS`（默认 800ms）
- 退出 1 条件：p99 > 阈值 **OR** p95 > 阈值 **OR** errors > 0
- 输出 `RESULT: ok|fail` 行（CI 解析用）
- CI mode 关 ANSI（`NO_COLOR=1` + `FORCE_COLOR=0` + isTTY=false）
- `main({runBench})` 注入 for testability

#### H-3: 测试 5 个
`backend/tests/perf-bench-ci.test.js`：
- p99 breach 退 1
- p95 breach 退 1
- errors > 0 退 1
- 全绿 exit 0
- ANSI suppress

#### H-4: 文档 + root script
- `docs/perf-bench.md` 加 "CI gate" 段
- `package.json` (root) 加 `perf:bench:ci`

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 338 | 335 | 2 | 1 |
| 2 | 338 | 335 | 2 | 1 |
| 3 | 338 | 335 | 2 | 1 |

baseline 316 → 338（+22：B 4 + C 14 + H 5 - 重叠）。0 新 fail。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | B in-process absolute counter（不用 PromQL rate） | 无 TSDB 也能用；alerts.yml 仍是 ops 真理源 |
| 2 | B default threshold 50 | 经验值；prod ~10/min 才需关注 |
| 3 | C adminLog.record 加 result 参数（不重构） | 向后兼容；旧调用走 unknown 默认 |
| 4 | C retention min 30 days | 防误删；手工 prune 走 /logs/prune（保留） |
| 5 | C 不改 /logs/security | 已存在的高优先级端点保持稳定 |
| 6 | C 不动 archive endpoint | 已在 R28 实现；R36 只加 retention cron |
| 7 | H PR-only 不 push | 每次 push 跑 4 endpoint 太贵 |
| 8 | H p95 阈值 800ms（p99 1500ms） | p95 比 p99 严，留 buffer |
| 9 | H 不加 real-LLM | 时间 + 成本；mock 已能反映真实延迟 |

## 风险

| 风险 | 缓解 |
|------|------|
| B counter 在 in-process 重启清零 | 进程重启 = 0，新窗口无 alert；阈值经验值兜底 |
| C result 列 ENUM 改枚举未来成本 | 改 ENUM 需 migration；先用 unknown 兜底 |
| C retention 误删关键日志 | min 30 天；归档表 admin_operation_logs_archive 仍存 |
| C filter 不索引 target_type/target_id | LIKE+ 等值命中现有 idx_action_time；如需更细可后续加 |
| H CI gate 误报（infra 慢） | threshold env 可调；非 required check（PR 可 override） |
| H mysql/redis 冷启动 | health-check 10s interval retries=10 |
| H perf CI 5 分钟预算紧 | 4 endpoint × 5s = 20s + setup 60s = ~80s，预算足 |

## 已知 Follow-up

| # | 项 | 优先级 |
|---|----|--------|
| 1 | 多 pod alert dedupe 改 Redis pub/sub | 低 |
| 2 | E `_v2` 重命名（spec 一致） | 低 |
| 3 | C filter 加 target_type / target_id 索引 | 低 |
| 4 | C adminLog 旧调用方 result=unknown 兼容期 | 低 |
| 5 | H perf gate 失败原因可视化（artifact 内容） | 中 |

## Commits

| SHA | msg |
|-----|-----|
| `ab2d38d` | feat(admin): audit log retention cron + manual trigger |
| `f7e5dc0` | feat(admin): /api/admin/logs/actions + /actors distinct endpoints |
| `06d955a` | feat(admin): audit logs filtering (action/actor/result/date/ip) |
| `22d82c9` | feat(admin): result column migration + adminLog signature |
| `1944da1` | feat(alerts): SlowQuerySpike rule (db_slow_queries_total > threshold) |
| `f935389` | ci(perf): docs + root perf:bench:ci script (p99<1500ms p95<800ms gate) |
| `c56118a` | perf(bench): BENCH_P95_MS threshold + CI mode output |