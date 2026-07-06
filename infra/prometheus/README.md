# Prometheus alerts

This directory holds PrometheusRule / Alertmanager-friendly alert definitions
for the resume-app backend.

## Files

| File          | Purpose                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------- |
| `alerts.yml`  | PrometheusRule-style alert rules. 7 critical alerts across 5 groups.                          |

The in-process firing endpoint lives at
`backend/src/routes/metricsAlerts.js` → `GET /api/internal/metrics/alerts`
and re-evaluates the same rules against the current prom-client snapshot.

## Importing `alerts.yml` into Prometheus

### Standalone Prometheus

1. Copy `alerts.yml` to the Prometheus host, e.g. `/etc/prometheus/rules/`.
2. In `prometheus.yml`, reference it under `rule_files`:

   ```yaml
   rule_files:
     - /etc/prometheus/rules/alerts.yml
   ```

3. Restart Prometheus (or send `SIGHUP` for hot-reload):

   ```bash
   kill -HUP $(pidof prometheus)
   ```

4. Verify rules loaded:

   ```bash
   curl http://prometheus:9090/api/v1/rules | jq '.data.groups[].rules[].name'
   ```

   You should see: `HighErrorRate`, `ElevatedErrorRate`, `RateLimitSpike`,
   `RedisDown`, `DBPoolExhausted`, `LLMFailureSpike`, `SlowRequestRate`.

### Prometheus Operator (kube-prometheus-stack)

The YAML uses the `PrometheusRule` CRD schema. Apply it directly:

```bash
kubectl apply -f alerts.yml
```

Namespace: defaults to current context. Override with `-n monitoring` etc.

## Alertmanager routing

The `severity` label drives routing. A minimal `alertmanager.yml`:

```yaml
route:
  group_by: ['alertname', 'service']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: default
  routes:
    - matchers:
        - severity = "critical"
      receiver: pagerduty
      group_wait: 10s
    - matchers:
        - severity = "warning"
      receiver: slack
      continue: true
receivers:
  - name: default
  - name: pagerduty
    pagerduty_configs:
      - service_key: <PAGERDUTY_KEY>
  - name: slack
    slack_configs:
      - api_url: <SLACK_WEBHOOK>
        channel: "#alerts"
```

## In-process firing endpoint

Even without Prometheus scraping this backend, `GET /api/internal/metrics/alerts`
returns currently-firing alerts by reading the live prom-client registry:

```bash
curl http://localhost:3000/api/internal/metrics/alerts
# {
#   "fired": [{ "name": "RateLimitSpike", "severity": "warning", ... }],
#   "checked": 7,
#   "generatedAt": "2026-07-06T..."
# }
```

`GET /api/internal/metrics/alerts/rules` returns the same rule list as JSON.

The in-process evaluator uses absolute counter thresholds (not PromQL rate
windows) since prom-client counters don't carry delta semantics on their
own. Thresholds are env-overridable:

| Env var                        | Default | Used by rule       |
| ------------------------------ | ------- | ------------------ |
| `ALERT_RL_BLOCK_THRESHOLD`     | 100     | RateLimitSpike     |
| `ALERT_HTTP_ERROR_THRESHOLD`   | 50      | HighErrorRate      |
| `ALERT_LLM_ERROR_THRESHOLD`    | 20      | LLMFailureSpike    |
| `ALERT_SLOW_OPS_THRESHOLD`     | 10      | SlowRequestRate    |
| `ALERT_DB_POOL_RATIO`          | 0.9     | DBPoolExhausted    |

## Testing locally

```bash
cd backend
npm test -- metricsAlerts
```

Three tests:

1. `/api/internal/metrics/alerts/rules` returns rule list + count.
2. `/api/internal/metrics/alerts` returns `{ fired: [], checked: 7 }` initially.
3. Stub `sliding_rate_limit_decisions_total` blocked counter → assert
   `RateLimitSpike` is in `fired[]`.