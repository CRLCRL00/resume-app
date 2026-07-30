const express = require('express');
const router = express.Router();
const client = require('prom-client');

// 单例 registry
const register = client.register;
client.collectDefaultMetrics({ register });

// 业务指标
const llmCalls = new client.Counter({
  name: 'llm_calls_total',
  help: 'LLM API calls',
  labelNames: ['call_path', 'status'],
});
const llmTokens = new client.Counter({
  name: 'llm_tokens_total',
  help: 'LLM token usage',
  labelNames: ['call_path', 'kind'],
});
// LLM 请求延迟直方图（按 operation + model 切片）
const llmRequestDuration = new client.Histogram({
  name: 'llm_request_duration_seconds',
  help: 'LLM upstream request duration',
  labelNames: ['operation', 'model'],
  buckets: [0.1, 0.25, 0.5, 1, 2, 4, 8, 16],
});
const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'HTTP requests by route + status',
  labelNames: ['method', 'route', 'status'],
});
// 延迟直方图：按 method + route + status
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});
// 慢操作：> 1s 自动记到 slowOps
const slowOps = new client.Counter({
  name: 'slow_operations_total',
  help: 'Operations exceeding 1s',
  labelNames: ['route', 'op'],
});
// DB 连接池：Gauge（采集时读取 pool 状态）
const dbPoolConnections = new client.Gauge({
  name: 'db_pool_connections',
  help: 'DB connection pool state',
  labelNames: ['state'], // all / free / used
});
// DB queries
const dbQueries = new client.Counter({
  name: 'db_queries_total',
  help: 'DB queries by status',
  labelNames: ['status'], // ok / err
});
const dbQueryDuration = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'DB query duration',
  labelNames: ['op'], // select / insert / update / delete
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});
// 慢查询仪表 (v2)：按 operation + table 维度切分
// 用 globalThis 单例防止 require 循环 / 重复 register
const dbQueryDurationV2 = globalThis.__dbQueryDurationV2
  || new client.Histogram({
    name: 'db_query_duration_seconds_v2',
    help: 'DB query duration by operation + table (slow query dashboard)',
    labelNames: ['operation', 'table'],
    buckets: [0.001, 0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
  });
globalThis.__dbQueryDurationV2 = dbQueryDurationV2;
const dbSlowQueries = globalThis.__dbSlowQueries
  || new client.Counter({
    name: 'db_slow_queries_total',
    help: 'DB queries exceeding slow threshold',
    labelNames: ['operation', 'table'],
  });
globalThis.__dbSlowQueries = dbSlowQueries;
// Round 40: multi-pod leader election metrics. Track who is the alert
// leader + how dispatches resolved (sent / skipped-not-leader / failed).
// Singleton via globalThis to avoid double-register in require cycles.
const alertDispatchTotal = globalThis.__alertDispatchTotal
  || new client.Counter({
    name: 'alert_dispatch_total',
    help: 'Alert dispatch outcomes by role',
    labelNames: ['role', 'result'], // result ∈ sent / skipped_not_leader / failed
  });
globalThis.__alertDispatchTotal = alertDispatchTotal;
const alertLeaderStatus = globalThis.__alertLeaderStatus
  || new client.Gauge({
    name: 'alert_leader_status',
    help: '1 if this pod currently holds the alert leader lease, else 0',
    labelNames: ['pod', 'role'],
  });
globalThis.__alertLeaderStatus = alertLeaderStatus;
// 周期采 DB pool + redis 状态
setInterval(() => {
  try {
    const pool = require('../config/db');
    // mysql2 v3 private API：pool.pool._allConnections / _freeConnections
    // 兼容兜底：拿不到就只报 config.connectionLimit
    const all = pool.pool?._allConnections?.length
      ?? pool.pool?.allConnections?.length
      ?? pool.pool?.config?.connectionLimit
      ?? 0;
    const free = pool.pool?._freeConnections?.length
      ?? pool.pool?.freeConnections?.length
      ?? 0;
    const used = Math.max(all - free, 0);
    dbPoolConnections.set({ state: 'all' }, all);
    dbPoolConnections.set({ state: 'free' }, free);
    dbPoolConnections.set({ state: 'used' }, used);
  } catch (_e) { /* 静默 */ }
}, 10000).unref();

/**
 * GET /api/internal/metrics — Prometheus exposition
 * Auth: ALLOW any (private IP / monitor only)
 */
router.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.send(await register.metrics());
  } catch (err) {
    res.status(500).send('# metrics scrape failed');
  }
});

/**
 * GET /api/internal/metrics/summary — JSON snapshot for ops dashboard
 * Returns last 5 minutes aggregates by reading Counter/Histogram values.
 */
router.get('/metrics/summary', async (req, res) => {
  try {
    const snapshot = {
      generatedAt: new Date().toISOString(),
      counters: {
        httpRequests: await getCounterMap(httpRequests),
        slowOps: await getCounterMap(slowOps),
        llmCalls: await getCounterMap(llmCalls),
        llmTokens: await getCounterMap(llmTokens),
      },
      gauges: {
        dbPoolConnections: await getGaugeMap(dbPoolConnections),
      },
    };
    res.json({ code: 0, data: snapshot });
  } catch (err) {
    res.status(500).json({ code: 500, message: 'snapshot failed' });
  }
});

/**
 * Prometheus client doesn't ship a JSON snapshot helper; gather values per label-set.
 */
async function getCounterMap(counter) {
  const out = {};
  const metrics = await counter.get();
  for (const v of metrics.values) {
    out[v.labels ? JSON.stringify(v.labels) : '{}'] = v.value;
  }
  return out;
}
async function getGaugeMap(gauge) {
  const out = {};
  const metrics = await gauge.get();
  for (const v of metrics.values) {
    out[v.labels ? JSON.stringify(v.labels) : '{}'] = v.value;
  }
  return out;
}

module.exports = {
  router,
  register,
  llmCalls,
  llmTokens,
  llmRequestDuration,
  httpRequests,
  httpDuration,
  slowOps,
  dbPoolConnections,
  dbQueries,
  dbQueryDuration,
  dbQueryDurationV2,
  dbSlowQueries,
  alertDispatchTotal,
  alertLeaderStatus,
};
