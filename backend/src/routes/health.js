const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const redis = require('../config/redis');
const logger = require('../utils/logger');

/** Liveness: 进程在 = 200. No external deps. */
router.get('/live', (_req, res) => {
  res.json({ code: 0, status: 'live' });
});

async function dbOk() {
  try {
    const [r] = await pool.query('SELECT 1 AS ok');
    return r[0] && r[0].ok === 1;
  } catch (_e) {
    return false;
  }
}
async function redisOk() {
  try {
    const r = await redis.ping();
    return r === 'PONG';
  } catch (_e) {
    return false;
  }
}

/** Readiness: DB + Redis 都 OK 才 200；任一失败 503. */
router.get('/ready', async (_req, res) => {
  const [db, rd] = await Promise.all([dbOk(), redisOk()]);
  const ok = db && rd;
  logger[ok ? 'info' : 'error']({ db, rd }, 'health/ready');
  res.status(ok ? 200 : 503).json({
    code: ok ? 0 : 1503,
    status: ok ? 'ready' : 'not_ready',
    db: db ? 'ok' : 'down',
    redis: rd ? 'ok' : 'down',
  });
});

/**
 * GET /api/health — basic process status. (backward-compat)
 * Cheap: no DB/Redis ping.
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
  try {
    const t0 = Date.now();
    await pool.query('SELECT 1');
    checks.db = { ok: true, latency_ms: Date.now() - t0 };
  } catch (err) {
    checks.db = { ok: false, error: err.message };
  }
  try {
    const t0 = Date.now();
    const r = await redis.ping();
    checks.redis = { ok: r === 'PONG', latency_ms: Date.now() - t0 };
  } catch (err) {
    checks.redis = { ok: false, error: err.message };
  }

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
