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

module.exports = {
  router,
  register,
  llmCalls,
  llmTokens,
  httpRequests,
  httpDuration,
  slowOps,
  dbPoolConnections,
};
