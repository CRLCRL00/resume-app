# 告警与指标阈值 (R31 + R36)

> TL;DR：8 条 in-process 告警规则 + Slack 路由（去重 / 静默 / fail-open）+ `infra/prometheus/alerts.yml` 作 ops 真理源。

## 规则列表（8 条）

| # | 名称 | 严重度 | 触发条件 | 阈值 env | 默认 |
|---|------|--------|----------|----------|------|
| 1 | `HighErrorRate` | critical | HTTP 5xx 计数 ≥ 2×threshold | `ALERT_HTTP_ERROR_THRESHOLD` | 50 |
| 2 | `ElevatedErrorRate` | warning | HTTP 5xx 计数 ≥ threshold | `ALERT_HTTP_ERROR_THRESHOLD` | 50 |
| 3 | `RateLimitSpike` | warning | `sliding_rate_limit_decisions_total{decision=blocked}` ≥ threshold | `ALERT_RL_BLOCK_THRESHOLD` | 100 |
| 4 | `RedisDown` | critical | **永不在进程内触发**（占位，依赖外部 blackbox_exporter） | — | — |
| 5 | `LLMFailureSpike` | warning | `llm_calls_total{status=error}` ≥ threshold | `ALERT_LLM_ERROR_THRESHOLD` | 20 |
| 6 | `DBPoolExhausted` | warning | `db_pool_connections{state=used}` / `state=all` ≥ ratio | `ALERT_DB_POOL_RATIO` | 0.9 |
| 7 | `SlowRequestRate` | warning | `slow_operations_total` sum ≥ threshold | `ALERT_SLOW_OPS_THRESHOLD` | 10 |
| 8 | `SlowQuerySpike` | warning | `db_slow_queries_total` sum ≥ threshold | `ALERT_SLOW_QUERY_THRESHOLD` | 50 |

完整源：`backend/src/routes/metricsAlerts.js`（规则定义 + 评估器）。

## 端点

```
GET /api/internal/metrics/alerts
GET /api/internal/metrics/alerts/rules
```

`metricsAlerts` 路由挂在 `/api/internal` 下。如 `ALERT_TOKEN` 设置了，需要 `Authorization: Bearer <token>`。

## Slack 通知（`alertRouter.js` R32-F）

每个 firing alert → `evaluateAndNotify({ fired })`：

1. **muted check** — `ALERT_MUTED` 是 CSV alert name，匹配则跳过
2. **dedupe check** — Redis `SET alert:notify:<name> NX EX <ttl>`，TTL 默认 60min (`ALERT_DEDUPE_TTL_MS`)
3. **fail-open** — Redis 异常时不阻挡通知（双发好过漏发）
4. **send** — `services/alertNotifier.js` 走 `SLACK_WEBHOOK_URL` / 频道 `SLACK_DEFAULT_CHANNEL`（默认 `#alerts`）
5. **security log** — critical 写一条 `securityLog` 事件

### 主动重发

`forceNotify({ name, value, threshold, severity })` 绕过 dedupe，给 ops 手动触发用。

## Prometheus YAML 源（`infra/prometheus/alerts.yml`）

in-process 评估器用**绝对计数器**（无 TSDB 也能用）；YAML 仍保留 **rate-based** PromQL 规则（`rate(...[5m])`），是配 Prometheus 时的真理源。两套阈值**独立维护**，调整时需同步。

新增的 `SlowQuerySpike` YAML：

```yaml
- alert: SlowQuerySpike
  expr: rate(db_slow_queries_total[5m]) > 0.5
  for: 5m
  labels: { severity: warning }
  annotations:
    summary: "DB 慢查询 > 0.5/s 持续 5 分钟"
```

## in-process 评估器注意事项

- **重启即清零**：`prom-client` Counter 自进程启动单调累计，pm2 reload 后归零，新窗口不会立刻告警。经验值阈值已留 buffer。
- **RedisDown 永真为 false**：进程内拿不到外部 `up{}`，靠 blackbox_exporter。
- **多 pod 部署下 dedupe 是「best-effort」**：每 pod 各自跑评估器，Redis 共享 dedupe key → 跨 pod 去重有效；未来扩多 pod 仍 OK。
- **不阻塞 HTTP 响应**：`metricsAlerts` 端点不 await Slack 推送耗时（`alertRouter.evaluateAndNotify` 内部对未配 webhook 走 logger.warn，不抛）。

## 调阈值

```bash
# backend/.env
ALERT_RL_BLOCK_THRESHOLD=200
ALERT_LLM_ERROR_THRESHOLD=50
ALERT_SLOW_QUERY_THRESHOLD=100
# 重启 pm2 reload
pm2 reload resume-app-backend --update-env
```

## 添加新规则

1. `RULES` 数组里加一个对象（`name/severity/thresholdKey/summary/description`）
2. `evaluateRule` switch 加 case
3. `THRESHOLDS` 加默认值 + env override
4. `infra/prometheus/alerts.yml` 同步加 PromQL 规则
5. `tests/metricsAlerts.test.js` 加覆盖

## 故障排查

| 现象 | 排查 |
|------|------|
| 没收到 Slack 告警 | 1) `SLACK_WEBHOOK_URL` 配了吗  2) `ALERT_MUTED` 把它静音了？ 3) dedupe TTL 内被跳过  4) 进程在容器内无法出网 |
| 收到重复告警 | 查 Redis `alert:notify:<name>` 键 TTL；可 `redis-cli del alert:notify:HighErrorRate` 强制重发 |
| critical 触发了但 ops 没看到 | 进程内 critical 写 `securityLog`，去 `admin_operation_logs` 查；Slack 通道如果挂了也会写 |
