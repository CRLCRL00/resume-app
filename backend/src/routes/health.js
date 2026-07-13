const express = require('express');
const router = express.Router();
const os = require('node:os');
const process = require('node:process');

const pool = require('../config/db');
const redis = require('../config/redis');
const logger = require('../utils/logger');

const VERSION = require('../../package.json').version || '0.1.0';

const START_TIME = Date.now();

// Cached Redis persistence info — read once at startup, cached for /api/health.
// Falls back to 'unknown' when not yet populated or CONFIG GET unavailable.
let PERSISTENCE_CACHE = { aof: 'unknown', rdb: 'unknown' };
let PERSISTENCE_POPULATED = false;

async function populatePersistenceCache() {
  if (PERSISTENCE_POPULATED) return PERSISTENCE_CACHE;
  try {
    const aofRes = await redis.call('CONFIG', 'GET', 'appendonly');
    const saveRes = await redis.call('CONFIG', 'GET', 'save');
    PERSISTENCE_CACHE = {
      aof: Array.isArray(aofRes) ? (aofRes[1] || 'unknown') : 'unknown',
      rdb: Array.isArray(saveRes) ? (saveRes[1] || '') : '',
    };
    PERSISTENCE_POPULATED = true;
  } catch (err) {
    // CONFIG GET may be disabled in test/managed Redis — keep cache as 'unknown'
    logger.warn({ err: err.message }, 'redis persistence cache populate failed');
    PERSISTENCE_POPULATED = true; // don't retry every health check
  }
  return PERSISTENCE_CACHE;
}

// Eagerly populate on module load (non-blocking)
populatePersistenceCache().catch(() => {});

async function pingDb() {
  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message };
  }
}

async function pingRedis() {
  const start = Date.now();
  // Round 33 chaos follow-up #1: defensive — malformed redis stub (no .ping)
  // throws TypeError "redis.ping is not a function" which leaks into the
  // public /health response. Detect missing method explicitly so error msg
  // is generic ("redis client missing ping()").
  if (typeof redis.ping !== 'function') {
    return { ok: false, latencyMs: Date.now() - start, error: 'redis client missing ping()' };
  }
  try {
    const pong = await redis.ping();
    return { ok: pong === 'PONG', latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message };
  }
}

/**
 * GET /api/health — 丰富状态
 * Includes: status, uptime, nodeVersion, env, version, dbPingMs, redisPingMs
 */
router.get('/', async (_req, res) => {
  const [db, rdb] = await Promise.all([pingDb(), pingRedis()]);
  const persistence = await populatePersistenceCache();
  const ok = db.ok && rdb.ok;
  logger[ok ? 'info' : 'error']({ db: db.ok, redis: rdb.ok }, 'health/');
  // Round 34 chaos follow-up #4: structured warn so ops can grep
  // for `component=redis` and correlate 503s with Redis outage.
  if (!ok) {
    if (!db.ok) logger.warn({ component: 'db', error: db.error }, 'health/ degraded');
    if (!rdb.ok) logger.warn({ component: 'redis', error: rdb.error }, 'health/ degraded');
  }
  res.status(ok ? 200 : 503).json({
    code: ok ? 0 : 1503,
    data: {
      status: ok ? 'ok' : 'degraded',
      env: process.env.NODE_ENV || 'development',
      version: VERSION,
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      nodeVersion: process.version,
      pid: process.pid,
      hostname: os.hostname(),
      dbPingMs: db.latencyMs,
      redisPingMs: rdb.latencyMs,
      db: db,
      redis: {
        ...rdb,
        persistence: {
          aof: persistence.aof,
          rdb: persistence.rdb,
        },
      },
    },
  });
});

/**
 * GET /api/health/live — k8s liveness: process alive
 * Flat top-level shape (backward-compat with existing k8s probes).
 */
router.get('/live', (_req, res) => {
  const uptime = Math.floor((Date.now() - START_TIME) / 1000);
  res.json({ code: 0, status: 'live', uptime });
});

/**
 * GET /api/health/ready — k8s readiness: DB + Redis both up
 * Flat top-level shape (backward-compat with existing k8s probes).
 */
router.get('/ready', async (_req, res) => {
  const [db, rdb] = await Promise.all([pingDb(), pingRedis()]);
  const ok = db.ok && rdb.ok;
  logger[ok ? 'info' : 'error']({ db: db.ok, redis: rdb.ok }, 'health/ready');
  // Round 34 chaos follow-up #4: structured warn so ops can grep
  // for `component=redis` and correlate 503s with Redis outage.
  if (!ok) {
    if (!db.ok) logger.warn({ component: 'db', error: db.error }, 'health/ready not_ready');
    if (!rdb.ok) logger.warn({ component: 'redis', error: rdb.error }, 'health/ready not_ready');
  }
  res.status(ok ? 200 : 503).json({
    code: ok ? 0 : 1503,
    status: ok ? 'ready' : 'not_ready',
    db: db.ok ? 'ok' : 'down',
    redis: rdb.ok ? 'ok' : 'down',
  });
});

module.exports = router;
