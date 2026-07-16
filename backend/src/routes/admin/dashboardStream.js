/**
 * R72+R77+R79: Server-Sent Events for dashboard realtime push.
 *
 * R79: Shared snapshot — ONE snapshot generation per tick, broadcast to
 * all open connections. Without this, N admin tabs × 1 snapshot/10s = N
 * duplicate DB queries per tick. With 50 connections that's 300 req/min
 * on dashboard endpoints — wasteful.
 *
 * Coalescing:
 *   - tick interval (default 10s) generates ONE snapshot
 *   - all registered connections get the same payload
 *   - if multiple snapshot requests arrive close together, in-flight
 *     promise is shared (no duplicate fetches)
 *   - connections are tracked in a Set; dead ones auto-remove on res.close
 *
 * Per-connection lifecycle:
 *   1. Auth middleware (userAuth + adminAuth) — runs first
 *   2. SSE headers set
 *   3. Connection added to registry
 *   4. Initial snapshot written
 *   5. Subsequent ticks broadcast to this connection
 *   6. On req.close: connection removed from registry
 *
 * Why SSE not WebSocket:
 *   - One-way (server → client) is all we need
 *   - mp-IDE / WeChat mini-program supports wx.request + onChunkReceived (HTTP chunked)
 *   - No socket lib / no upgrade dance / works through proxies
 *   - Auto-reconnect built into clients
 */
const express = require('express');
const router = express.Router();
const { userAuth } = require('../../middleware/auth');
const { adminAuth } = require('../../middleware/adminAuth');
const mysql = require('mysql2/promise');
const client = require('prom-client');
const config = require('../../config');
const logger = require('../../utils/logger');

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
const MIN_SNAPSHOT_INTERVAL_MS = 1_000; // coalesce burst requests within this window

// R80: prom metrics for SSE observability. Singleton via globalThis to
// avoid double-register in require cycles (same pattern as metrics.js).
const sseActiveConnections = globalThis.__sseActiveConnections
  || new client.Gauge({
    name: 'sse_active_connections',
    help: 'Current number of open SSE connections',
  });
globalThis.__sseActiveConnections = sseActiveConnections;

const sseConnectionsTotal = globalThis.__sseConnectionsTotal
  || new client.Counter({
    name: 'sse_connections_total',
    help: 'Total SSE connections accepted (lifetime)',
  });
globalThis.__sseConnectionsTotal = sseConnectionsTotal;

const sseSnapshotsTotal = globalThis.__sseSnapshotsTotal
  || new client.Counter({
    name: 'sse_snapshots_total',
    help: 'Dashboard snapshot generations (after coalesce)',
  });
globalThis.__sseSnapshotsTotal = sseSnapshotsTotal;

const sseSnapshotDuration = globalThis.__sseSnapshotDuration
  || new client.Histogram({
    name: 'sse_snapshot_duration_seconds',
    help: 'Duration of one snapshot generation (DB queries)',
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  });
globalThis.__sseSnapshotDuration = sseSnapshotDuration;

const sseCacheAge = globalThis.__sseCacheAge
  || new client.Gauge({
    name: 'sse_cache_age_seconds',
    help: 'Age of the latest shared snapshot',
  });
globalThis.__sseCacheAge = sseCacheAge;

// R81: total rejected connections due to per-admin cap
const sseRejectedConnections = globalThis.__sseRejectedConnections
  || new client.Counter({
    name: 'sse_rejected_connections_total',
    help: 'SSE connections rejected (per-admin cap exceeded)',
    labelNames: ['reason'],
  });
globalThis.__sseRejectedConnections = sseRejectedConnections;

// R83: total events replayed on connect with Last-Event-ID
const sseReplayedTotal = globalThis.__sseReplayedTotal
  || new client.Counter({
    name: 'sse_replayed_events_total',
    help: 'Total events replayed on reconnect with Last-Event-ID',
  });
globalThis.__sseReplayedTotal = sseReplayedTotal;

// R82: monotonically-increasing event id (process-local). Each event sent to
// clients includes `id: <n>` so they can reconnect with `Last-Event-ID` header
// and resume from where they left off. The header value is captured on
// connect (logged + exposed via _stats for ops debug).
let _eventId = 0;
function nextEventId() { return ++_eventId; }

// R83: ring buffer of recent events for resume. On reconnect with a valid
// Last-Event-ID, replay all events with id > Last-Event-ID before streaming
// live. Buffer cap = 100 events ≈ ~16 min at 10s tick + 15s heartbeats.
// Beyond that, resume silently fails — client gets current snapshot instead.
const REPLAY_BUFFER_SIZE = 100;
const replayBuffer = []; // [{id, event, data, ts}] in id order (oldest first)
function bufferEvent(id, event, data, ts) {
  replayBuffer.push({ id, event, data, ts });
  if (replayBuffer.length > REPLAY_BUFFER_SIZE) {
    replayBuffer.splice(0, replayBuffer.length - REPLAY_BUFFER_SIZE);
  }
}
function getReplaySince(lastEventId) {
  const id = Number(lastEventId);
  if (!Number.isFinite(id)) return [];
  // replayBuffer may contain events with id < id (if buffer rotated past it);
  // in that case return empty (client too stale) and caller can still send current snapshot.
  return replayBuffer.filter((e) => e.id > id);
}

// R79+R81: connection registry indexed by admin openid. Map<openid, Set<conn>>
// so we can enforce per-admin cap and quickly count active conns per admin.
const connectionsByAdmin = new Map(); // openid → Set<{ res, id, openid, connectedAt }>
let cachedSnapshot = null;
let cachedSnapshotAt = 0;
let snapshotPromise = null;

function _addConn(conn) {
  let set = connectionsByAdmin.get(conn.openid);
  if (!set) { set = new Set(); connectionsByAdmin.set(conn.openid, set); }
  set.add(conn);
  sseActiveConnections.set(_totalCount());
  sseConnectionsTotal.inc();
}

function _removeConn(conn) {
  const set = connectionsByAdmin.get(conn.openid);
  if (set) {
    set.delete(conn);
    if (set.size === 0) connectionsByAdmin.delete(conn.openid);
  }
  sseActiveConnections.set(_totalCount());
}

function _totalCount() {
  let n = 0;
  for (const set of connectionsByAdmin.values()) n += set.size;
  return n;
}

function _connCount(openid) {
  const set = connectionsByAdmin.get(openid);
  return set ? set.size : 0;
}

async function fetchSnapshot() {
  const t0 = Date.now();
  const snap = { ts: Date.now() };
  try {
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

    const [degree_rows] = await streamPool.query(`
      SELECT COALESCE(degree_required, '不限') AS bucket, COUNT(*) AS n
      FROM jobs WHERE is_deleted = 0 AND is_online = 1
      GROUP BY bucket ORDER BY n DESC
    `);
    snap.degree = degree_rows;

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
  // R80: record snapshot duration
  sseSnapshotDuration.observe((Date.now() - t0) / 1000);
  return snap;
}

/**
 * R79: get a recent snapshot (cached or in-flight). Coalesces burst requests.
 */
async function getSharedSnapshot() {
  const now = Date.now();
  // Fresh cache: use it
  if (cachedSnapshot && now - cachedSnapshotAt < MIN_SNAPSHOT_INTERVAL_MS) {
    sseCacheAge.set((now - cachedSnapshotAt) / 1000);
    return cachedSnapshot;
  }
  // Stale or missing: kick off fetch (or join in-flight)
  if (snapshotPromise) return snapshotPromise;
  snapshotPromise = fetchSnapshot()
    .then((s) => {
      cachedSnapshot = s;
      cachedSnapshotAt = Date.now();
      sseSnapshotsTotal.inc();
      sseCacheAge.set(0);
      return s;
    })
    .catch((e) => {
      // Don't poison cache on error
      logger.warn({ err: e.message }, 'sse snapshot fetch failed');
      return cachedSnapshot || { ts: Date.now(), error: e.message };
    })
    .finally(() => {
      snapshotPromise = null;
    });
  return snapshotPromise;
}

router.use(userAuth, adminAuth);

router.get('/', async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders && res.flushHeaders();

  const conn = {
    res,
    id: Math.random().toString(36).slice(2, 10),
    connectedAt: Date.now(),
    openid: (req.user && req.user.openid) || 'unknown',
    lastEventId: req.headers['last-event-id'] || null, // R82
  };

  // R82+R83: replay missed events since lastEventId
  if (conn.lastEventId) {
    const replay = getReplaySince(conn.lastEventId);
    sseReplayedTotal.inc(replay.length);
    logger.info(
      {
        connId: conn.id,
        openid: conn.openid,
        lastEventId: conn.lastEventId,
        replayEvents: replay.length,
      },
      replay.length ? 'sse: replaying missed events' : 'sse: client too stale for replay'
    );
    for (const e of replay) {
      try {
        res.write(`id: ${e.id}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
      } catch (_) { /* dead conn, let close handler clean */ }
    }
    // If buffer empty (or replayed all), still continue to initial snapshot below
  }

  // R81: enforce per-admin cap before committing resources
  const current = _connCount(conn.openid);
  if (current >= MAX_CONNECTIONS_PER_ADMIN) {
    sseRejectedConnections.inc({ reason: 'per_admin_cap' });
    logger.warn(
      { openid: conn.openid, current, cap: MAX_CONNECTIONS_PER_ADMIN },
      'sse: rejected connection (per-admin cap)'
    );
    // Drain headers / close cleanly so client sees a proper response
    res.status(429).json({
      code: 1429,
      message: `too many concurrent SSE connections for this admin (max ${MAX_CONNECTIONS_PER_ADMIN})`,
      current,
      cap: MAX_CONNECTIONS_PER_ADMIN,
    });
    return;
  }

  _addConn(conn);
  logger.info(
    { connId: conn.id, openid: conn.openid, total: _totalCount(), perAdmin: _connCount(conn.openid) },
    'sse: client connected'
  );

  let alive = true;
  function cleanup() {
    if (!alive) return;
    alive = false;
    _removeConn(conn);
    logger.info(
      { connId: conn.id, total: _totalCount(), perAdmin: _connCount(conn.openid) },
      'sse: client disconnected'
    );
  }
  req.on('close', cleanup);
  req.on('error', cleanup);

  // initial snapshot (uses shared cache → coalesces if many connect at once)
  try {
    const snap = await getSharedSnapshot();
    const eid = nextEventId();
    res.write(`id: ${eid}\nevent: dashboard-update\ndata: ${JSON.stringify(snap)}\n\n`);
    bufferEvent(eid, 'dashboard-update', snap, Date.now());
  } catch (e) {
    const eid = nextEventId();
    res.write(`id: ${eid}\nevent: error\ndata: ${JSON.stringify({ err: e.message })}\n\n`);
    bufferEvent(eid, 'error', { err: e.message }, Date.now());
  }
});

// R79: single ticker — broadcast cached snapshot to all connections.
// Runs continuously regardless of connection count (cheap when 0 conn).
let tickerStarted = false;
function ensureTickerStarted() {
  if (tickerStarted) return;
  tickerStarted = true;

  setInterval(async () => {
    if (_totalCount() === 0) return; // skip DB when no listeners
    const snap = await getSharedSnapshot();
    const eid = nextEventId();
    const payload = `id: ${eid}\nevent: dashboard-update\ndata: ${JSON.stringify(snap)}\n\n`;
    bufferEvent(eid, 'dashboard-update', snap, Date.now());
    let sent = 0;
    let failed = 0;
    for (const set of connectionsByAdmin.values()) {
      for (const conn of set) {
        try {
          conn.res.write(payload);
          sent += 1;
        } catch (e) {
          failed += 1;
          // Dead connection — let 'close' handler clean it up
        }
      }
    }
    if (sent > 0 || failed > 0) {
      logger.debug({ sent, failed, total: _totalCount(), eventId: eid }, 'sse: tick broadcast');
    }
  }, PUSH_INTERVAL_MS);

  // Heartbeat — keep connections warm through proxies (15s)
  setInterval(() => {
    const eid = nextEventId();
    const payload = `id: ${eid}\nevent: heartbeat\ndata: ${JSON.stringify({ ts: eid })}\n\n`;
    bufferEvent(eid, 'heartbeat', { ts: eid }, Date.now());
    for (const set of connectionsByAdmin.values()) {
      for (const conn of set) {
        try { conn.res.write(payload); } catch (_) { /* dead */ }
      }
    }
  }, HEARTBEAT_MS);
}
ensureTickerStarted();

// Expose stats for ops/tests
function _stats() {
  const perAdmin = {};
  for (const [openid, set] of connectionsByAdmin.entries()) {
    perAdmin[openid] = set.size;
  }
  return {
    connections: _totalCount(),
    admins: connectionsByAdmin.size,
    perAdmin,
    lastSnapshotAt: cachedSnapshotAt,
    cacheAgeMs: cachedSnapshotAt ? Date.now() - cachedSnapshotAt : null,
    nextEventId: _eventId,
    replayBufferSize: replayBuffer.length,
    replayBufferCapacity: REPLAY_BUFFER_SIZE,
  };
}

module.exports = router;
module.exports._stats = _stats;
// R83: expose buffer helpers for ops/tests (read-only)
module.exports._buffer = {
  size: () => replayBuffer.length,
  capacity: REPLAY_BUFFER_SIZE,
  oldest: () => replayBuffer[0] || null,
  newest: () => replayBuffer[replayBuffer.length - 1] || null,
};