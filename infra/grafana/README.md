# Grafana Dashboard — SSE (R87)

## 导入方式

### 方式 A: UI 导入 (一次性)

1. Grafana → Dashboards → New → Import
2. Upload JSON file `sse-dashboard.json`
3. 选择 Prometheus datasource
4. Done — 自动 10s refresh

### 方式 B: Provisioned (推荐, 重启自动恢复)

把 `sse-dashboard.json` 放到 `/etc/grafana/provisioning/dashboards/`,
加 provisioning yaml:

```yaml
# /etc/grafana/provisioning/dashboards/resume-app.yaml
apiVersion: 1
providers:
  - name: resume-app
    orgId: 1
    folder: Resume App
    type: file
    disableDeletion: false
    updateIntervalSeconds: 60
    allowUiUpdates: true
    options:
      path: /etc/grafana/provisioning/dashboards
```

启动 Grafana → 自动加载.

## 面板说明

| Panel | Metric | 用途 |
|---|---|---|
| 1 | `sse_active_connections` | 当前 SSE 连接数 (stat, 阈值告警) |
| 2 | `rate(sse_connections_total)` | 新连接速率 (监控异常 spike) |
| 3 | `rate(sse_snapshots_total)` | snapshot 生成速率 (~1/10s/pod, spike = 多 pod 不同步) |
| 4 | `sse_snapshot_duration_seconds` | snapshot 耗时 p50/p95/p99 (>1s 慢) |
| 5 | `rate(sse_rejected_connections_total)` by reason | 拒绝原因分布 (per-admin cap / heartbeat?) |
| 6 | `rate(sse_replayed_events_total)` | 重传速率 (高 = 客户端频繁断) |
| 7 | `sse_cache_age_seconds` | snapshot cache 年龄 (>5s 异常) |

## Redis Buffer 健康

SSE metrics 不直接包含 replay buffer 状态. 用 Redis exporter (默认 port 9121):

```promql
# buffer 大小
redis_list_length{key="sse:replay:buffer"}
# buffer TTL (sec)
redis_key_ttl_seconds{key="sse:replay:buffer"}
# event id 计数器
redis_value_value{key="sse:event:id"}
```

如果用 prometheus-redis-exporter, 在 Grafana 加 panel:

| 指标 | PromQL |
|---|---|
| Buffer count | `redis_list_length{key="sse:replay:buffer"}` |
| Buffer TTL | `redis_key_ttl_seconds{key="sse:replay:buffer"}` (应 ≈ 86400) |
| Event ID | `redis_value_value{key="sse:event:id"}` (单调递增) |

## Alert 建议 (R87+ 可加)

```yaml
# alertmanager yaml 片段
groups:
  - name: sse
    rules:
      - alert: SSEConnectionsHigh
        expr: sum(sse_active_connections) > 50
        for: 5m
      - alert: SSESnapshotSlow
        expr: histogram_quantile(0.95, sum(rate(sse_snapshot_duration_seconds_bucket[5m])) by (le)) > 1
        for: 2m
      - alert: SSEBufferStale
        expr: redis_key_ttl_seconds{key="sse:replay:buffer"} < 3600
        for: 1m
        # TTL < 1h = 23h 没 push = 服务挂了
```

## Datasource 准备

`prometheus.yml` scrape config:

```yaml
scrape_configs:
  - job_name: resume-app-backend
    static_configs:
      - targets: ['127.0.0.1:3003']
    metrics_path: /api/metrics
```

后端 `prom-client` 已 expose (R80). 不需改后端.

## 验证

无 live Grafana. JSON schema check (手动):

```bash
python3 -c "import json; json.load(open('infra/grafana/sse-dashboard.json'))" && echo "JSON_OK"
```

Dev server 可用 `docker run -p 3000:3000 grafana/grafana` + `prom/prometheus` + `prom/redis-exporter` 本地试 import.