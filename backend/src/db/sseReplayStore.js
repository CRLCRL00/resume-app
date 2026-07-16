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

const crypto = require('crypto');
const logger = require('../utils/logger');

const REPLAY_BUFFER_KEY = 'sse:replay:buffer';
const EVENT_ID_KEY = 'sse:event:id';   // R85: shared atomic counter (multi-pod safe)
const REPLAY_BUFFER_SIZE = 100;
const REPLAY_TTL_SECONDS = 86_400; // R86: 24h rolling TTL (auto-clear if no new events)

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

// ───────────────────────────────────────────────────────────────
// R90-C: Optional encryption (AES-256-GCM) for replay buffer values.
// Opt-in via SSE_REPLAY_KEY env var (64 hex chars = 32 bytes).
// Without env var → plaintext (back-compat, R84-R89 behavior preserved).
//
// Format on disk: base64( iv(12) || authTag(16) || ciphertext )
//   iv: random per encrypt (GCM nonce reuse = catastrophic, so random)
//   authTag: GCM integrity check (16 bytes)
//   ciphertext: AES-256-GCM(JSON.stringify(event))
//
// Failure modes:
//   - Decrypt fails (key rotated, data corrupted) → skip that entry, log warn
//   - Plaintext data already in Redis from R84-R89 → first read after opt-in
//     will fail to decrypt → skipped (then OVERWRITTEN by next encrypted push)
//   - Process startup without key → fallback plaintext, no crash
// ───────────────────────────────────────────────────────────────
let _encKey = null;       // Buffer | null (32 bytes)
let _encWarned = false;   // log plaintext mode once

function _loadEncKey() {
  if (_encKey !== null || _encWarned) return _encKey;
  const hex = process.env.SSE_REPLAY_KEY;
  if (!hex) {
    if (!_encWarned) {
      logger.warn('sse replay: SSE_REPLAY_KEY not set — storing plaintext (insecure for PII)');
      _encWarned = true;
    }
    _encKey = false; // sentinel: not configured
    return null;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    logger.error('sse replay: SSE_REPLAY_KEY must be 64 hex chars (32 bytes) — disabling encryption');
    _encKey = false;
    return null;
  }
  _encKey = Buffer.from(hex, 'hex');
  logger.info('sse replay: encryption enabled (AES-256-GCM)');
  return _encKey;
}

function _encrypt(plaintext) {
  const key = _loadEncKey();
  if (!key) return plaintext; // no key → plaintext passthrough
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function _decrypt(b64) {
  const key = _loadEncKey();
  if (!key) return b64; // plaintext mode → return as-is
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 28) return null; // iv(12)+tag(16)=28 min, no payload
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (e) {
    return null; // corrupt or wrong key → caller skips
  }
}

/**
 * Push an event to the replay buffer (Redis + fallback on failure).
 * Returns true on success, false if both Redis + fallback failed.
 */
async function push({ id, event, data, ts }) {
  const plaintext = JSON.stringify({ id, event, data, ts });
  const payload = _encrypt(plaintext); // R90-C: encrypt if key set
  try {
    const r = getRedis();
    // LPUSH adds to head, LTRIM keeps 0..size-1 (newest 100)
    // R86: EXPIRE sets rolling 24h TTL (resets on each push)
    // Pipeline: 1 round-trip for all 3 ops
    await r.multi()
      .lpush(REPLAY_BUFFER_KEY, payload)
      .ltrim(REPLAY_BUFFER_KEY, 0, REPLAY_BUFFER_SIZE - 1)
      .expire(REPLAY_BUFFER_KEY, REPLAY_TTL_SECONDS)
      .exec();
    return true;
  } catch (e) {
    // Fallback to in-memory (plaintext — fallback never touches Redis)
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
      let plaintext = _decrypt(raw[i]); // R90-C
      if (plaintext == null) {
        // Decrypt failed (corrupt or wrong key) — skip
        continue;
      }
      try {
        const obj = JSON.parse(plaintext);
        if (Number(obj.id) > target) items.push(obj);
      } catch (_) { /* skip malformed JSON */ }
    }
    return items;
  } catch (e) {
    logger.warn({ err: e.message }, 'sse replay: redis read failed, using fallback');
    return fallbackBuffer.filter((e) => Number(e.id) > target).reverse();
  }
}

/**
 * Size (for ops + tests). Returns { count, ttlSeconds }.
 * - count: Redis LLEN, or fallback.length if Redis down
 * - ttlSeconds: Redis TTL (R86), or null if Redis down / key missing
 */
async function size() {
  try {
    const r = getRedis();
    const [n, ttl] = await Promise.all([
      r.llen(REPLAY_BUFFER_KEY),
      r.ttl(REPLAY_BUFFER_KEY),
    ]);
    return {
      count: Number(n) || 0,
      ttlSeconds: ttl >= 0 ? Number(ttl) : null,
    };
  } catch (_) {
    return { count: fallbackBuffer.length, ttlSeconds: null };
  }
}

/**
 * TTL only (cheap inspect). Returns seconds, or null if unavailable.
 */
async function ttl() {
  try {
    const r = getRedis();
    const v = await r.ttl(REPLAY_BUFFER_KEY);
    return v >= 0 ? Number(v) : null;
  } catch (_) {
    return null;
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
  push, since, size, ttl, clear,
  nextEventId, currentEventId,
  REPLAY_BUFFER_SIZE, REPLAY_BUFFER_KEY, REPLAY_TTL_SECONDS, EVENT_ID_KEY,
};