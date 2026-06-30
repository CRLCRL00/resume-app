const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const redis = require('../config/redis');
const logger = require('../utils/logger');

/**
 * GET /api/health — basic process status.
 */
router.get('/', (req, res) => {
  res.json({
    code: 0,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
  });
});

/**
 * GET /api/health/deep — ping DB + Redis; returns 503 if any sub-system down.
 * Use for: load balancer health checks, uptime monitoring.
 */
router.get('/deep', async (req, res) => {
  const checks = {};
  // DB
  try {
    const t0 = Date.now();
    await pool.query('SELECT 1');
    checks.db = { ok: true, latency_ms: Date.now() - t0 };
  } catch (err) {
    checks.db = { ok: false, error: err.message };
  }
  // Redis
  try {
    const t0 = Date.now();
    const r = await redis.ping();
    checks.redis = { ok: r === 'PONG', latency_ms: Date.now() - t0 };
  } catch (err) {
    checks.redis = { ok: false, error: err.message };
  }

  // 阈值告警：>500ms 视为 degraded，但仍 200
  const LATENCY_WARN_MS = 500;
  const dbLatency = checks.db.latency_ms || 0;
  const redisLatency = checks.redis.latency_ms || 0;
  if (checks.db.ok && dbLatency > LATENCY_WARN_MS) {
    checks.db.degraded = true;
    checks.db.note = `latency ${dbLatency}ms > ${LATENCY_WARN_MS}ms`;
  }
  if (checks.redis.ok && redisLatency > LATENCY_WARN_MS) {
    checks.redis.degraded = true;
    checks.redis.note = `latency ${redisLatency}ms > ${LATENCY_WARN_MS}ms`;
  }

  const allOk = checks.db.ok && checks.redis.ok;
  // 部分降级 → 199 自定义 status 让 LB 报警但不踢实例
  const status = allOk ? 200 : 503;
  const anyDegraded = checks.db.degraded || checks.redis.degraded;
  logger[allOk ? (anyDegraded ? 'warn' : 'info') : 'error'](checks, 'health/deep');

  res.status(status).json({
    code: allOk ? 0 : 1500,
    data: {
      status: allOk ? 'ok' : 'down',
      degraded: anyDegraded,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    },
  });
});

module.exports = router;
