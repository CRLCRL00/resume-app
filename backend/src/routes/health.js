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

  const allOk = checks.db.ok && checks.redis.ok;
  logger[allOk ? 'info' : 'warn'](checks, 'health/deep');

  res.status(allOk ? 200 : 503).json({
    code: allOk ? 0 : 1500,
    data: {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    },
  });
});

module.exports = router;
