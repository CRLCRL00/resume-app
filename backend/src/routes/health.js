const express = require('express');
const router = express.Router();
const os = require('node:os');
const process = require('node:process');

const pool = require('../config/db');
const redis = require('../config/redis');
const logger = require('../utils/logger');

const VERSION = require('../../package.json').version || '0.1.0';

const START_TIME = Date.now();

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
  const ok = db.ok && rdb.ok;
  logger[ok ? 'info' : 'error']({ db: db.ok, redis: rdb.ok }, 'health/');
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
      redis: rdb,
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
  res.status(ok ? 200 : 503).json({
    code: ok ? 0 : 1503,
    status: ok ? 'ready' : 'not_ready',
    db: db.ok ? 'ok' : 'down',
    redis: rdb.ok ? 'ok' : 'down',
  });
});

module.exports = router;
