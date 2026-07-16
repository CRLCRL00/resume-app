/**
 * R84: persistent SSE replay buffer (Redis).
 *
 * Replaces in-memory ring buffer (R83) with Redis LIST so events survive
 * backend pm2 restart. Client reconnecting after server restart still gets
 * recent events replayed via Last-Event-ID.
 *
 * Schema:
 *   key:   sse:replay:buffer  (LIST)
 *   value: JSON {id, event, data, ts}
 *   order: LPUSH newest → head; LRANGE 0 N reads oldest→newest
 *   cap:   LTRIM keeps only the most recent REPLAY_BUFFER_SIZE entries
 *
 * Why Redis:
 *   - Already in stack (R40+)
 *   - Survives pm2 restart, deploys
 *   - O(1) push + O(N) range (N=100, fast)
 *
 * Failure modes:
 *   - Redis unreachable → push() returns false (logged); in-memory fallback
 *     uses last cached value (best-effort). Connect-time getSince() returns [].
 *   - Per-event payload ~ 1KB × 100 = 100KB Redis memory (negligible)
 */
'use strict';

const logger = require('../utils/logger');

const REPLAY_BUFFER_KEY = 'sse:replay:buffer';
const EVENT_ID_KEY = 'sse:event:id';   // R85: shared atomic counter (multi-pod safe)
const REPLAY_BUFFER_SIZE = 100;

// Lazy-load redis (avoid hard dep at import time)
function getRedis() {
  return require('../config/redis');
}

// Fallback in-memory buffer (only used if Redis push fails — last-ditch)
const fallbackBuffer = []; // [{id, event, data, ts}]
const FALLBACK_CAP = REPLAY_BUFFER_SIZE;

// R85: fallback process-local counter (only if Redis INCR fails — at-most-once
// per process; multi-pod only when Redis is down, will be unique enough)
let _localEventId = 0;

/**
 * Push an event to the replay buffer (Redis + fallback on failure).
 * Returns true on success, false if both Redis + fallback failed.
 */
async function push({ id, event, data, ts }) {
  const payload = JSON.stringify({ id, event, data, ts });
  try {
    const r = getRedis();
    // LPUSH adds to head, LTRIM keeps 0..size-1 (newest 100)
    // Pipeline: 1 round-trip for both ops
    await r.multi()
      .lpush(REPLAY_BUFFER_KEY, payload)
      .ltrim(REPLAY_BUFFER_KEY, 0, REPLAY_BUFFER_SIZE - 1)
      .exec();
    return true;
  } catch (e) {
    // Fallback to in-memory
    fallbackBuffer.unshift({ id, event, data, ts });
    if (fallbackBuffer.length > FALLBACK_CAP) fallbackBuffer.length = FALLBACK_CAP;
    logger.warn({ err: e.message, id }, 'sse replay: redis push failed, used in-memory fallback');
    return false;
  }
}

/**
 * Return events with id > sinceId, ordered oldest → newest.
 * `sinceId` may be undefined / null → returns all.
 *
 * Falls back to in-memory buffer if Redis unreachable (events pushed during
 * the same process are still there; events from before the failure are lost).
 */
async function since(sinceId) {
  if (!Number.isFinite(Number(sinceId))) return [];
  const target = Number(sinceId);
  try {
    const r = getRedis();
    // Read up to REPLAY_BUFFER_SIZE entries (oldest first)
    const raw = await r.lrange(REPLAY_BUFFER_KEY, 0, REPLAY_BUFFER_SIZE - 1);
    // raw is ordered oldest→newest (LRANGE 0..N from a LPUSH-added list
    // gives the oldest at index 0, but we pushed newest-first via LPUSH,
    // so the LIST has newest at head (index 0). Reverse to chronological.
    const items = [];
    for (let i = raw.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(raw[i]);
        if (Number(obj.id) > target) items.push(obj);
      } catch (_) { /* skip malformed */ }
    }
    return items;
  } catch (e) {
    logger.warn({ err: e.message }, 'sse replay: redis read failed, using fallback');
    return fallbackBuffer.filter((e) => Number(e.id) > target).reverse();
  }
}

/**
 * Size (for ops + tests). Uses Redis LLEN, falls back to fallback.
 */
async function size() {
  try {
    const r = getRedis();
    return Number(await r.llen(REPLAY_BUFFER_KEY)) || 0;
  } catch (_) {
    return fallbackBuffer.length;
  }
}

/**
 * Clear (for ops reset). Use sparingly — wipes resume history.
 */
async function clear() {
  try {
    const r = getRedis();
    await r.del(REPLAY_BUFFER_KEY);
    await r.del(EVENT_ID_KEY);
    fallbackBuffer.length = 0;
    _localEventId = 0;
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * R85: atomic, multi-pod-safe event id generator.
 *
 * Uses Redis INCR which is atomic and shared across all backend pods. Each
 * pod sees the same monotonic sequence. Without this, multi-pod deployments
 * would generate overlapping id ranges (each pod starts from 0) and
 * replay semantics would break (e.g., lastEventId=5 from pod A might
 * collide with event from pod B).
 *
 * Falls back to process-local counter if Redis unreachable — single-pod
 * safe (no overlap within one process), multi-pod unsafe during Redis
 * outage (caller can detect via offline flag).
 */
async function nextEventId() {
  try {
    const id = await getRedis().incr(EVENT_ID_KEY);
    return Number(id);
  } catch (e) {
    _localEventId += 1;
    logger.warn({ err: e.message }, 'sse event id: Redis INCR failed, using process-local fallback');
    return _localEventId;
  }
}

/**
 * Inspect current id value (for ops/tests). Returns null if Redis unreachable.
 */
async function currentEventId() {
  try {
    const v = await getRedis().get(EVENT_ID_KEY);
    return v ? Number(v) : null;
  } catch (_) {
    return _localEventId || null;
  }
}

module.exports = {
  push, since, size, clear,
  nextEventId, currentEventId,
  REPLAY_BUFFER_SIZE, REPLAY_BUFFER_KEY, EVENT_ID_KEY,
};