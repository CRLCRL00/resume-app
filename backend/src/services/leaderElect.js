/**
 * leaderElect.js — Round 40 multi-pod leader election via Redis.
 *
 * Why:
 *   Each pod runs the alert evaluator (metricsAlerts → alertRouter) and
 *   can fire Slack notifications. With N pods behind a load balancer
 *   each Prometheus scrape / external scheduler can trigger N alerts
 *   per firing event — duplicates. Existing per-alert dedupe in
 *   alertRouter handles *same* alert *within* TTL, but does NOT prevent
 *   different pods from racing to send on the same fired event.
 *
 *   Solution: single-leader-per-role pattern. One pod holds a Redis
 *   lease (`leader:{role}` key). Others stay silent. If leader dies,
 *   the lease expires (TTL) and another pod takes over within ~TTL.
 *
 *   Implementation uses `SET NX EX` for atomic acquire and a small
 *   Lua script for safe release (only the leader can release its own
 *   lease — prevents stealing a freshly-acquired lease from another
 *   pod that took over after we crashed).
 *
 * Fail-open on Redis hiccups:
 *   If Redis is unreachable, tryAcquire / getLeader / release throw.
 *   Callers in alertRouter treat this as "treat as leader" so alerts
 *   are NOT silently dropped (matches the existing dedupe fail-open
 *   posture: better to double-send than miss an incident).
 *
 * Env:
 *   ALERT_LEADER_TTL_SEC     default 30
 *   ALERT_LEADER_HEARTBEAT_MS default 5000  (must be < TTL)
 *
 * Hook order:
 *   const leaderElect = require('./services/leaderElect');
 *   const ok = await leaderElect.tryAcquire('alert');
 *   // ... or use startHeartbeat for auto-renew
 *   await leaderElect.startHeartbeat('alert');
 *   // graceful shutdown: await leaderElect.stopHeartbeat('alert');
 */
const os = require('os');
const logger = require('../utils/logger');

const DEFAULT_TTL_SEC = 30;
const DEFAULT_HEARTBEAT_MS = 5000;

// Singleton heartbeat timers per role (so multiple startHeartbeat calls
// for the same role don't create competing timers).
const heartbeats = new Map(); // role -> { timer, ttlSec, intervalMs }

// Optional Redis injection for tests. Default to ../config/redis.
let _redis = null;
function setRedis(client) { _redis = client; }
function getRedis() {
  if (_redis) return _redis;
  // Lazy require so tests that mock via setRedis() never hit the real conn.
  _redis = require('../config/redis');
  return _redis;
}

/**
 * Stable per-process pod identity. hostname disambiguates across hosts;
 * pid disambiguates same-host restarts (old + new pod would otherwise share
 * a name until old one's lease expires).
 */
function podName() {
  return `${os.hostname()}:${process.pid}`;
}

function key(role) {
  return `leader:${role}`;
}

function ttlSec() {
  return Math.max(5, Number(process.env.ALERT_LEADER_TTL_SEC) || DEFAULT_TTL_SEC);
}

function heartbeatMs() {
  return Math.max(1000, Number(process.env.ALERT_LEADER_HEARTBEAT_MS) || DEFAULT_HEARTBEAT_MS);
}

/**
 * Try to acquire the leader lease for `role`.
 * Returns:
 *   { acquired: true,  leader: <thisPod>, ttl }
 *   { acquired: false, leader: <otherPod> | null, ttl }
 *
 * Throws on Redis errors. Callers (alertRouter) fail-open on throw.
 */
async function tryAcquire(role, opts = {}) {
  const ttl = Number(opts.ttlSec) > 0 ? Number(opts.ttlSec) : ttlSec();
  const name = podName();
  const k = key(role);
  const res = await getRedis().set(k, name, 'EX', ttl, 'NX');
  if (res === 'OK') {
    return { acquired: true, leader: name, ttl };
  }
  // Someone else owns it; read who.
  const current = await getRedis().get(k);
  return { acquired: false, leader: current, ttl };
}

/**
 * Release the lease for `role` — but only if THIS pod currently owns it.
 * Implemented via tiny Lua script so the check-and-delete is atomic:
 *   if redis.call('GET', KEYS[1]) == ARGV[1] then
 *     return redis.call('DEL', KEYS[1])
 *   else return 0 end
 *
 * Returns true if we released, false if we were no longer leader
 * (e.g. lease had expired and another pod took over).
 */
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;
async function release(role) {
  const k = key(role);
  const name = podName();
  const r = await getRedis().eval(RELEASE_SCRIPT, 1, k, name);
  return Number(r) === 1;
}

/**
 * Read current leader pod name for `role`, or null if no leader.
 */
async function getLeader(role) {
  const v = await getRedis().get(key(role));
  return v || null;
}

/**
 * Whether this pod currently holds the lease for `role`.
 */
async function isLeader(role) {
  const leader = await getLeader(role);
  return leader !== null && leader === podName();
}

/**
 * Start a periodic heartbeat that renews our TTL while we hold the lease.
 * Idempotent per role — calling twice for the same role is a no-op.
 *
 * NOTE: This does NOT acquire the lease — call tryAcquire first.
 * The heartbeat just re-SETs the key (extending TTL) only if we still
 * own it; if we lose the race (lease expired + another pod acquired),
 * the heartbeat silently does nothing and logs.
 */
function startHeartbeat(role, opts = {}) {
  if (heartbeats.has(role)) return false; // already running
  const ttl = Number(opts.ttlSec) > 0 ? Number(opts.ttlSec) : ttlSec();
  const intervalMs = Number(opts.intervalMs) > 0 ? Number(opts.intervalMs) : heartbeatMs();
  const name = podName();

  const renewScript = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
else
  return 0
end
`;

  const timer = setInterval(async () => {
    try {
      const k = key(role);
      const r = await getRedis().eval(renewScript, 1, k, name, String(ttl));
      if (Number(r) !== 1) {
        // We no longer own the lease — stop the heartbeat to avoid
        // spamming logs every 5s.
        logger.warn({ role, pod: name }, 'leader heartbeat: lost lease, stopping');
        stopHeartbeat(role);
      }
    } catch (err) {
      // Redis hiccup — keep trying; next tick may succeed. Log at warn
      // (not error) because transient outages are expected.
      logger.warn({ role, err: err.message }, 'leader heartbeat failed; will retry');
    }
  }, intervalMs);

  // Don't keep the process alive solely for the heartbeat.
  if (typeof timer.unref === 'function') timer.unref();
  heartbeats.set(role, { timer, ttlSec: ttl, intervalMs });
  logger.info({ role, pod: name, ttl, intervalMs }, 'leader heartbeat started');
  return true;
}

/**
 * Stop the heartbeat for `role` and (best-effort) release the lease.
 * Safe to call when no heartbeat is active.
 */
async function stopHeartbeat(role) {
  const h = heartbeats.get(role);
  if (h) {
    clearInterval(h.timer);
    heartbeats.delete(role);
    logger.info({ role, pod: podName() }, 'leader heartbeat stopped');
  }
  try { await release(role); }
  catch (err) {
    logger.warn({ role, err: err.message }, 'leader release on stop failed');
  }
  return true;
}

/**
 * Test helper: returns all active heartbeat roles. Not for prod use.
 */
function _activeHeartbeats() {
  return Array.from(heartbeats.keys());
}

/**
 * Test helper: hard-stop everything + forget the cached redis client.
 */
function _resetAll() {
  for (const [role] of heartbeats) {
    const h = heartbeats.get(role);
    if (h) clearInterval(h.timer);
  }
  heartbeats.clear();
  _redis = null;
}

module.exports = {
  // Core API
  tryAcquire,
  release,
  getLeader,
  isLeader,
  // Heartbeat lifecycle
  startHeartbeat,
  stopHeartbeat,
  // Identity
  podName,
  // Test hooks
  setRedis,
  _resetAll,
  _activeHeartbeats,
  // Constants for tests
  DEFAULT_TTL_SEC,
  DEFAULT_HEARTBEAT_MS,
  RELEASE_SCRIPT,
};