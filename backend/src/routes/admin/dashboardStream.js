/**
 * R72: Server-Sent Events for dashboard realtime push.
 *
 * Why SSE not WebSocket:
 *   - One-way (server → client) is all we need
 *   - mp-IDE / WeChat mini-program supports wx.request + onChunkReceived (HTTP chunked)
 *   - No socket lib / no upgrade dance / works through proxies
 *   - Auto-reconnect built into clients
 *
 * Endpoint: GET /api/admin/dashboard/stream
 *   - Headers: text/event-stream, Cache-Control: no-cache, Connection: keep-alive
 *   - Events:
 *       event: dashboard-update
 *       data: {"ts":<unix_ms>,"overview":{...},"cities":{...},...}
 *       (then blank line)
 *
 *   - Heartbeat every 15s:
 *       event: heartbeat
 *       data: {"ts":<unix_ms>}
 *
 * Push cadence: 10s (better than 30s polling, still cheap — 1 query per pod)
 */
const express = require('express');
const router = express.Router();
const { userAuth } = require('../../middleware/auth');
const { adminAuth } = require('../../middleware/adminAuth');
const mysql = require('mysql2/promise');
const config = require('../../config');

const streamPool = mysql.createPool({
  host: config.DB.host,
  port: config.DB.port,
  user: config.DB.user,
  password: config.DB.password,
  database: config.DB.database,
  waitForConnections: true,
  connectionLimit: 2,
  charset: 'utf8mb4',
});

const PUSH_INTERVAL_MS = 10_000;
const HEARTBEAT_MS = 15_000;

router.use(userAuth, adminAuth);

router.get('/', async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders && res.flushHeaders();

  let closed = false;
  req.on('close', () => { closed = true; clearInterval(pushTimer); clearInterval(hbTimer); });

  async function fetchSnapshot() {
    try {
      const [[overview]] = await streamPool.query(`
        SELECT
          (SELECT COUNT(*) FROM users) AS users,
          (SELECT COUNT(*) FROM resumes WHERE is_active = 1) AS active_resumes,
          (SELECT COUNT(*) FROM jobs WHERE is_online = 1 AND is_deleted = 0) AS online_jobs,
          (SELECT COUNT(*) FROM matches) AS total_matches
      `);
      return { ts: Date.now(), overview };
    } catch (e) {
      return { ts: Date.now(), error: e.message };
    }
  }

  // initial snapshot
  const initial = await fetchSnapshot();
  res.write(`event: dashboard-update\ndata: ${JSON.stringify(initial)}\n\n`);

  const pushTimer = setInterval(async () => {
    if (closed) return;
    try {
      const snap = await fetchSnapshot();
      res.write(`event: dashboard-update\ndata: ${JSON.stringify(snap)}\n\n`);
    } catch (e) {
      res.write(`event: error\ndata: ${JSON.stringify({ err: e.message })}\n\n`);
    }
  }, PUSH_INTERVAL_MS);

  const hbTimer = setInterval(() => {
    if (closed) return;
    res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  }, HEARTBEAT_MS);
});

module.exports = router;