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
};
