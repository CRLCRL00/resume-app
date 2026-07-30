# 开发日志 — 2026-07-01（Phase 8+ Round 20）

> 阶段：8+ Round 20
> 前置：[2026-07-01-phase8-plus-round19.md](../devlog/2026-07-01-phase8-plus-round19.md)

## 目标

3 个 hardening 项：
A. Readiness/Liveness 双 endpoint + start-prod health gate
B. Webhook outbound 重试 + 死信 + HMAC 签名
C. DB query Counter + Duration Histogram

## 最终结果

| 项 | 状态 |
|----|------|
| A health 双 endpoint | ✅ /live + /ready + /deep 兼容 + start-prod.sh |
| B webhook 重试 | ✅ 3 测 / 死信表 + 服务层 |
| C db query metrics | ✅ Counter + Histogram(idempotent wrap) |
| npm test 3x | ✅ 174 pass / 1 skip × 3 稳（170 → 174）|

## 改动详情

### A — health + start-prod

`backend/src/routes/health.js`：
- `GET /live` 进程在 = 200，无外部依赖
- `GET /ready` DB+Redis parallel，503 on fail
- 兼容 `/` 与 `/deep` 不破旧 consumer

`backend/scripts/start-prod.sh`（19 行，LF，`100755`）：
- curl loop 30s 等 `/api/health/ready` 200；超时 exit 1
- 给 PM2 reload 前用，杜绝"启动未就绪就接流量"

### B — webhook 重试

`backend/src/services/webhook.js`（新）：
- `deliver({ url, payload, secret, attempts=3 })` — 0.5s/1s/2s 指数退避
- 5s `AbortSignal.timeout(5000)` 兜底
- 成功 2xx 即返；全失败后 INSERT `alerts_dead_letter`
- `signPayload(secret, body)` HMAC-SHA256 签名，`X-Signature: sha256=…` 头

`backend/src/db/schema.sql:168-180` 加 CREATE TABLE + migration row `005-alerts-dead-letter`。

`backend/src/db/005-alerts-dead-letter.sql`（独立文件，便于手工执行）。

`backend/src/routes/alerts.js`：
- 现有 inbound-only，无 fetch；保持不动
- 模块导出加 `forwardAlert(url, payload)` 作为 outbound API 表面

测试用本地 `http.createServer` mock + 死信通过截 `pool.query` 验证 INSERT。

### C — db query metrics

`backend/src/routes/metrics.js`：
- `dbQueries` Counter `{status: ok|err}`
- `dbQueryDuration` Histogram `{op: select|insert|update|delete|other}` + 10 buckets

`backend/src/config/db.js`：
- `pool.__metricsWrapped` flag 防重入
- `wrap()` 工厂 lazy require `'../routes/metrics'`（避免循环）
- 同时包 `pool.query` 和 `pool.execute`
- SQL 首 token 解析 op

`/metrics` 输出验证：
```
db_queries_total{status="ok"} 1
db_query_duration_seconds_bucket{le="0.05",op="select"} 1
```

## npm test

| Run | pass | fail | skip | tests |
|-----|------|------|------|-------|
| 1 | 174 | 0 | 1 | 175 |
| 2 | 174 | 0 | 1 | 175 |
| 3 | 174 | 0 | 1 | 175 |

baseline 168 → 174（+6: health 2 / webhook 3 / dbMetrics 1）。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A `/live` 无依赖 | k8s 风格；不查 DB 避免误杀重启 |
| 2 | A 保留 `/deep` 路由 | 旧 monitor consumer 仍依赖 |
| 3 | B 5s timeout | 防单次挂死；超时也走退避 |
| 4 | B dead-letter 失败仅 log | 不二次失败影响主路径 |
| 5 | C lazy require 路由 metrics | 防 db ↔ metrics 循环 |
| 6 | C `__metricsWrapped` flag | 防多次 require 后双包 |

## 风险

| 风险 | 缓解 |
|------|------|
| A start-prod.sh Windows 无 chmod | git update-index 设 100755；首次部署 `chmod +x` |
| B retry 期间 alert 延迟 | 退避总和 3.5s，紧急告警仍及时 |
| B pool.query mock 影响并行测试 | node:test 默认顺序；webhook.test.js 排末尾 |
| C SELECT 解析误判（注释/SQL 头）| 简单正则仅看首 token；CTE 等走 `other` |

## Commits

| SHA | msg |
|-----|-----|
| dbb6b4a | feat(ops): readiness/liveness 双 endpoint + start-prod health gate |
| b3738b9 | feat(alerts): outbound webhook 重试 + 死信 + HMAC 签名 |
| 61453d0 | feat(observability): DB query Counter + Duration Histogram |
