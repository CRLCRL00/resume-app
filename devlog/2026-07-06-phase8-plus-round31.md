# 开发日志 — 2026-07-06（Phase 8+ Round 31）

> 阶段：8+ Round 31 — ADF hardening
> 前置：[2026-07-06-phase8-plus-round30.md](../devlog/2026-07-06-phase8-plus-round30.md)

## 目标

3 hardening 项：
B. 后端 CI workflow（test on PR + push develop）
C. Prometheus alerts 规则 + 进程内触发端点
D. client_errors TTL 清理 cron + 聚合

## 最终结果

| 项 | 状态 |
|----|------|
| B backend-ci.yml | ✅ 102 行 YAML + mysql/redis services + health-checks |
| C Prometheus alerts | ✅ 7 rules + `/api/internal/metrics/alerts` + 3 测 |
| D client_errors cleanup | ✅ cron 24h + summary + 5 测 |
| **npm test 3x** | ✅ **264 / 261 pass / 2 fail / 1 skip** × 3 |

baseline 256 → 264（+8：metrics 3 + cleanup 5）。2 fail pre-existing authLockout。

## 改动详情

### B — Backend CI Workflow

`.github/workflows/backend-ci.yml`（新，102 行）：
- triggers: `pull_request → [develop, main]` + `push → [develop]`
- concurrency: `backend-ci-${{ github.ref }}` + cancel-in-progress
- timeout: 10 min
- job `test` on `ubuntu-latest`：
  - services:
    - `mysql:8`：root=test，db=resume_app，health-cmd=`mysqladmin ping`，interval=10s，retries=10
    - `redis:7`：health-cmd=`redis-cli ping`，同样参数
  - env（13 个，全部 fake 值，无 `secrets.*` 引用）：
    - `NODE_ENV=test`
    - DB/Redis 连接
    - `JWT_SECRET=test-secret-not-for-prod-do-not-use-anywhere-real`
    - `WX_APPID/WX_SECRET=test_*`
    - `DEEPSEEK_API_KEY=sk-test-placeholder`
    - `ALERT_TOKEN=test-alert-token`
    - `DEEPSEEK_BASE_URL=https://api.deepseek.com/v1`
    - `DEEPSEEK_MODEL=deepseek-chat`
    - `JWT_EXPIRES_IN=30d`
    - `DB_POOL_SIZE=10`
    - `LOG_LEVEL=info`
    - `CORS_ALLOWED_ORIGINS=https://servicewechat.com`
    - `SENTRY_DSN=''`
  - steps:
    1. `actions/checkout@v4`
    2. `actions/setup-node@v4` v20 + npm cache path=`backend`
    3. `cd backend && npm ci`
    4. `cd backend && npm run db-init -- --test`（schema 创建）
    5. `cd backend && node run-tests.js`
    6. upload-artifact `if: always()`

### C — Prometheus Alerts

`infra/prometheus/alerts.yml`（新，7 rules，5 groups）：

| Name | Severity | For | 表达式 |
|------|----------|-----|--------|
| HighErrorRate | critical | 5m | 5xx/总 > 5% |
| ElevatedErrorRate | warning | 5m | 5xx/总 > 1% |
| RateLimitSpike | warning | 5m | decision=blocked rate > 0.5/s |
| RedisDown | critical | 1m | up{job=backend} == 0（external probe） |
| LLMFailureSpike | warning | 5m | llm_calls 错误率 > 20% |
| DBPoolExhausted | warning | 5m | used/all > 90% |
| SlowRequestRate | warning | 5m | slow_ops > 0.1/s |

`infra/prometheus/README.md`（新）：导入方式 + ops 文档。

`backend/src/routes/metricsAlerts.js`（新）：
- **lazy counter loading**：不 top-level require slidingRateLimit（会 eager connect redis + 在 test 中 hang）；通过 `globalThis.__slidingRateLimitCounter` 拿，缺失 fallback local Counter
- 进程内评估：5 个阈值（env 可覆盖 `ALERT_*`），NOT PromQL（没 TSDB 也能用）
- `GET /api/internal/metrics/alerts` → `{ fired: [...], checked: 7, thresholds, generatedAt }`
- `GET /api/internal/metrics/alerts/rules` → 规则列表（JSON）
- Auth：可选 `Bearer ALERT_TOKEN`（与 alerts.js/metrics.js 一致）

测 `backend/tests/metricsAlerts.test.js`（3）：
- rules 端点返 7 rules
- 初始 `{ fired: [] }`
- 模拟 blocked counter +200 → `RateLimitSpike` 在 fired[]

样例 firing 输出：
```json
{"code":0,"data":{"fired":[{"name":"RateLimitSpike","severity":"warning","value":200,"threshold":100,...}],"checked":7,...}}
```

`backend/src/app.js` mount metricsAlertsRouter at `/api/internal`。

### D — client_errors TTL 清理

`backend/src/jobs/clientErrorsCleanup.js`（新）：
- `runClientErrorsCleanup({pool, retentionDays=7, batchSize=1000, logger})`
- 策略：MySQL 8 `DELETE FROM client_errors WHERE created_at < NOW() - INTERVAL ? DAY LIMIT ?` 分批循环，到 affected < batchSize 停
- 返 `{ deleted, batches, durationMs, retentionDays }`
- 幂等：二次运行 0 deletes
- 参数化查询防 SQL injection

`backend/src/services/clientErrorsAgg.js`（新）：
- `summarizeClientErrors({pool, windowHours=24})` → `{ total, byType, byPlatform, lastErrorAt }`
- 单 GROUP BY 查询，便宜

`backend/src/routes/clientErrorsAdmin.js`（新）：
- `POST /api/internal/client-errors/cleanup`（ALERT_TOKEN auth）
- `GET /api/internal/client-errors/summary?hours=N`（同上 auth）

`backend/src/index.js` cron：
- `setTimeout(runCleanup, 60_000)`（boot 后 1min）
- `setInterval(runCleanup, 86_400_000)`（24h）
- 都 `.unref()` + `isTestEnv()` 短路（test 不起 cron）

测 `backend/tests/clientErrorsCleanup.test.js`（5）：
- retentionDays=7 → 8-day-old 删，3-day 留
- 二次运行 delete=0（幂等）
- retentionDays=2 → 删全部 > 2 天
- batchSize=1 → 多 batch
- summarize 返聚合

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 264 | 261 | 2 | 1 |
| 2 | 264 | 261 | 2 | 1 |
| 3 | 264 | 261 | 2 | 1 |

baseline 256 → 264（+8）。0 新 fail。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | B 全 fake env 无 secrets.* | PR 不需要 secret（除 ALERT_TOKEN 不用） |
| 2 | B services health-checks 10s interval retries=10 | 避免测试因 cold start 误报 |
| 3 | B db-init step | MySQL 容器内 schema 必须先建 |
| 4 | C lazy counter loading | eager import 会 redis connect + 在 CI 残留连接 |
| 5 | C absolute thresholds ≠ PromQL | 无 TSDB 也能用，确定性 |
| 6 | C 7 rules 而非满覆盖 | 留扩展位（client_errors 已 prepared） |
| 7 | D batched DELETE LIMIT | MySQL 8 原生；避免长事务 |
| 8 | D cron .unref() + isTestEnv | test 不挂，shutdown 干净 |
| 9 | D summary 单独端点 | 配 cleanup 同 token 同 path 对 |

## 风险

| 风险 | 缓解 |
|------|------|
| B CI 没 lint | 留后；引入 ESLint 须先有团队共识 |
| B health-check start-period | 20s 容忍 cold start；不够再调 |
| C in-process 阈值不准 | 上线接 Prometheus/Alertmanager 时改用 .rules 导入 |
| D cron 误删 | retentionDays 默认 7，可调；报警可加 |
| D 测试 DB 锁 | 用 unique openid 隔离，并发安全 |

## Commits

| SHA | msg |
|-----|-----|
| `f51b80a` | ci(backend): GitHub Actions workflow for tests on PR + push develop |
| `9d6d1bb` | feat(alerts): prometheus alert rules + in-process firing endpoint |
| `2d4ac02` | feat(jobs): client_errors daily TTL cleanup + aggregation summary |
