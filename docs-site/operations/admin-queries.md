# 慢查询仪表盘 (R35)

> TL;DR：每条慢 SQL（> `SLOW_QUERY_MS=200ms`）进 500-条 ring buffer + Prometheus 计数器；admin 端点拉快照。

## 数据来源

`backend/src/services/queryMetrics.js` 提供：

- 内存 ring buffer（`Array`，FIFO，max 500）
- `byTable` 聚合（`{ tableName: count }`）
- `slowCount` / `totalTracked` 计数
- Prometheus `db_query_duration_seconds_v2` 直方图（label `{operation, table}`）
- Prometheus `db_slow_queries_total` 计数器（同 label）

入口：`recordQuery({ sql, durationMs, operation, table })`，`db.js` 的 query wrap 在执行后调用。

## 阈值 & 跳过

```js
const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS) || 200;
const SKIP_RE = /^\s*(SET|SHOW|USE|START\s+TRANSACTION|COMMIT)\b/i;
```

不计入的：admin / 协议级 SQL（`SET autocommit`, `SHOW WARNINGS` 等）。其他都进。

## 端点

### `GET /api/admin/queries/slow`

| Query | 类型 | 默认 | 说明 |
|-------|------|------|------|
| `limit` | int | 20 | 最大 500 |
| `since` | string | `1h` | 支持 `Ns/Nm/Nh/Nd` 或纯毫秒数 |

```jsonc
{
  "code": 0,
  "data": {
    "items": [
      { "ts": 1752345678901, "operation": "select", "table": "resumes",
        "durationMs": 412, "sql": "SELECT * FROM resumes WHERE ..." }
    ],
    "total": 12,
    "limit": 20,
    "sinceMs": 3600000
  }
}
```

### `GET /api/admin/queries/stats`

```jsonc
{
  "code": 0,
  "data": {
    "threshold": 200,
    "totalTracked": 8432,
    "slowCount": 47,
    "byTable": { "resumes": 19, "admin_operation_logs": 12, "jobs": 9, ... }
  }
}
```

两个端点都需 `userAuth + adminAuth`。

## Prometheus 指标

```promql
# 慢查询率
rate(db_slow_queries_total[5m])

# p95 延迟（按表）
histogram_quantile(0.95, rate(db_query_duration_seconds_v2_bucket{table="resumes"}[5m]))

# Top 慢表
topk(5, sum by (table) (rate(db_slow_queries_total[5m])))
```

## 与告警联动

`SlowQuerySpike` 告警（`ALERT_SLOW_QUERY_THRESHOLD=50` 默认）触发后，ops 进来查 `/api/admin/queries/slow` 看具体 SQL：

1. 看 `byTable` 哪个表拖累
2. 看 `sql` 找索引缺失 / 全表扫
3. 加索引或改写 SQL
4. 重启观察 1h 趋势

## 已知限制

- **in-memory**：pm2 reload 后清空。需要历史查 Prometheus 长期存储。
- **SQL 截断 200 字符**：超长 INSERT 看不到完整文本。
- **unknown table**：解析失败的归 `unknown`（少数带子查询或 CTE 的 SQL 走到 fallback）。
- **跨进程聚合**：每 pod 各自 buffer。多 pod 时 PromQL `sum by` 仍是真理。

## 测试入口

```js
const queryMetrics = require('./services/queryMetrics');
queryMetrics._resetForTests();
queryMetrics._bufferForTests();     // 拿内部 buffer 引用
```

不要在生产调 `_resetForTests`。
