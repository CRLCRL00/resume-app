/**
 * R72+R77: Server-Sent Events for dashboard realtime push.
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
 *       data: {"ts":<unix_ms>,"overview":{...},"cities":{...},"salary":[...],...}
 *
 *   - Heartbeat every 15s:
 *       event: heartbeat
 *       data: {"ts":<unix_ms>}
 *
 * Push cadence: 10s (R77: now pushes ALL sections; mp client can replace
 * polling entirely when SSE is open)
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
    const snap = { ts: Date.now() };
    try {
      // 1. overview
      const [[overview]] = await streamPool.query(`
        SELECT
          (SELECT COUNT(*) FROM users) AS users,
          (SELECT COUNT(*) FROM resumes WHERE is_active = 1) AS active_resumes,
          (SELECT COUNT(*) FROM resumes) AS total_resumes,
          (SELECT COUNT(*) FROM jobs WHERE is_online = 1 AND is_deleted = 0) AS online_jobs,
          (SELECT COUNT(*) FROM jobs WHERE is_deleted = 0) AS total_jobs,
          (SELECT COUNT(*) FROM matches) AS total_matches,
          (SELECT COUNT(*) FROM matches WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS matches_7d,
          (SELECT COUNT(*) FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS users_7d,
          (SELECT COUNT(*) FROM resumes WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS resumes_7d
      `);
      snap.overview = overview;

      // 2. cities
      const [users_city_rows] = await streamPool.query(`
        SELECT
          COALESCE(JSON_UNQUOTE(JSON_EXTRACT(source_form, '$.expected.city')), 'unknown') AS city,
          COUNT(*) AS n
        FROM resumes
        WHERE JSON_EXTRACT(source_form, '$.expected.city') IS NOT NULL
          AND is_active = 1
        GROUP BY city ORDER BY n DESC LIMIT 30
      `);
      const [jobs_city_rows] = await streamPool.query(`
        SELECT COALESCE(city, 'unknown') AS city, COUNT(*) AS n
        FROM jobs WHERE is_deleted = 0 AND is_online = 1
        GROUP BY city ORDER BY n DESC LIMIT 30
      `);
      snap.cities = {
        users_by_city: users_city_rows.slice(0, 10),
        jobs_by_city: jobs_city_rows.slice(0, 10),
      };

      // 3. salary
      const [salary_rows] = await streamPool.query(`
        SELECT
          CASE
            WHEN salary_min < 10000 THEN '<10K'
            WHEN salary_min < 15000 THEN '10-15K'
            WHEN salary_min < 20000 THEN '15-20K'
            WHEN salary_min < 30000 THEN '20-30K'
            WHEN salary_min < 50000 THEN '30-50K'
            ELSE '50K+'
          END AS bucket,
          COUNT(*) AS n,
          ROUND(AVG(salary_min)/1000, 1) AS avg_min_k,
          ROUND(AVG(salary_max)/1000, 1) AS avg_max_k
        FROM jobs
        WHERE is_deleted = 0 AND is_online = 1
        GROUP BY bucket
        ORDER BY FIELD(bucket, '<10K', '10-15K', '15-20K', '20-30K', '30-50K', '50K+')
      `);
      snap.salary = salary_rows;

      // 4. degree
      const [degree_rows] = await streamPool.query(`
        SELECT COALESCE(degree_required, '不限') AS bucket, COUNT(*) AS n
        FROM jobs WHERE is_deleted = 0 AND is_online = 1
        GROUP BY bucket ORDER BY n DESC
      `);
      snap.degree = degree_rows;

      // 5. trends (14d)
      const [users_t] = await streamPool.query(
        `SELECT DATE(created_at) AS date, COUNT(*) AS n
         FROM users WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
         GROUP BY DATE(created_at) ORDER BY date`
      );
      const [resumes_t] = await streamPool.query(
        `SELECT DATE(created_at) AS date, COUNT(*) AS n
         FROM resumes WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
         GROUP BY DATE(created_at) ORDER BY date`
      );
      const [matches_t] = await streamPool.query(
        `SELECT DATE(created_at) AS date, COUNT(*) AS n
         FROM matches WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
         GROUP BY DATE(created_at) ORDER BY date`
      );
      const byDate = new Map();
      const setN = (rows, key) => {
        for (const r of rows) {
          const k = r.date.toISOString ? r.date.toISOString().slice(0, 10) : String(r.date);
          const obj = byDate.get(k) || { date: k, users: 0, resumes: 0, matches: 0 };
          obj[key] = Number(r.n);
          byDate.set(k, obj);
        }
      };
      setN(users_t, 'users');
      setN(resumes_t, 'resumes');
      setN(matches_t, 'matches');
      snap.trends = Array.from(byDate.values());
    } catch (e) {
      snap.error = e.message;
    }
    return snap;
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