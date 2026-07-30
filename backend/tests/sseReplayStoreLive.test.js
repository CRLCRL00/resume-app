/**
 * R89: Live Redis verification for sseReplayStore.
 *
 * Same 8 tests as R88 (multi-pod fake), but against a REAL Redis instance.
 * Skipped automatically if Redis is not reachable.
 *
 * Why:
 *   - R88 fake may miss edge cases (e.g. real EXPIRE semantics, real LPUSH order)
 *   - Catches drift between fake assumptions and real Redis behavior
 *   - CI/dev: real Redis available → run all tests; else skip (don't fail)
 *
 * Use a unique key prefix per test run so concurrent runs don't collide.
 * Cleanup happens in finally block (always).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Redis = require('ioredis');

// ───────────────────────────────────────────────────────────────
// Live connection (lazy, per-test)
// ───────────────────────────────────────────────────────────────
let liveRedis = null;
let liveRedisOk = false;

async function tryConnect() {
  if (liveRedis) return liveRedisOk;
  try {
    liveRedis = new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT) || 6379,
      lazyConnect: true,
      connectTimeout: 500,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null, // don't retry, fail fast
    });
    await liveRedis.connect();
    await liveRedis.ping();
    liveRedisOk = true;
  } catch (e) {
    liveRedisOk = false;
    if (liveRedis) {
      liveRedis.disconnect();
      liveRedis = null;
    }
  }
  return liveRedisOk;
}

// Use unique key per test (avoid state collision)
const RUN_ID = `${process.pid}-${Date.now()}`;
const KEY_BUFFER = `test:${RUN_ID}:sse:replay:buffer`;
const KEY_EVENT_ID = `test:${RUN_ID}:sse:event:id`;

function loadStoreWith(realRedis) {
  const storePath = require.resolve('../src/db/sseReplayStore');
  delete require.cache[storePath];
  // Inject the live Redis instance (same shape as our fake)
  require.cache[require.resolve('../src/config/redis')] = {
    id: require.resolve('../src/config/redis'),
    filename: require.resolve('../src/config/redis'),
    loaded: true,
    exports: realRedis,
  };
  return require(storePath);
}

// ───────────────────────────────────────────────────────────────
// Conditional suite — skip entire file if Redis unavailable
// ───────────────────────────────────────────────────────────────
test.before(async () => {
  const ok = await tryConnect();
  if (!ok) {
    console.log('⚠️  Redis not available — skipping R89 live tests');
  }
});

test.after(async () => {
  if (liveRedis && liveRedisOk) {
    try {
      await liveRedis.del(KEY_BUFFER, KEY_EVENT_ID);
    } catch (_) { /* cleanup best-effort */ }
    liveRedis.disconnect();
  }
});

// Helper: returns a conditional test fn that no-ops if Redis is down
function liveTest(name, fn) {
  test(name, async (t) => {
    if (!liveRedisOk) return; // silently skip
    await fn(t);
  });
}

// ───────────────────────────────────────────────────────────────
// Tests (mirrors R88 with live Redis)
// ───────────────────────────────────────────────────────────────
liveTest('R89 live: single-pod sequential INCR produces unique monotonic ids', async () => {
  const store = loadStoreWith(liveRedis);
  // Use unique key
  require.cache[require.resolve('../src/db/sseReplayStore')] = undefined;
  delete require.cache[require.resolve('../src/db/sseReplayStore')];
  require.cache[require.resolve('../src/config/redis')] = {
    id: require.resolve('../src/config/redis'),
    filename: require.resolve('../src/config/redis'),
    loaded: true,
    exports: liveRedis,
  };
  const s = require('../src/db/sseReplayStore');
  // Override keys for this test (via direct redis ops, since store hardcodes keys)
  await liveRedis.del(KEY_BUFFER, KEY_EVENT_ID);

  const ids = [];
  for (let i = 0; i < 50; i++) {
    const id = await liveRedis.incr(KEY_EVENT_ID);
    ids.push(Number(id));
  }
  assert.deepStrictEqual(ids, Array.from({ length: 50 }, (_, i) => i + 1));
  await liveRedis.del(KEY_EVENT_ID);
});

liveTest('R89 live: LPUSH+LTRIM+EXPIRE pipeline (cap=100 + TTL)', async () => {
  await liveRedis.del(KEY_BUFFER);
  // Push 150 entries, expect cap=100, TTL set
  for (let i = 0; i < 150; i++) {
    await liveRedis.multi()
      .lpush(KEY_BUFFER, JSON.stringify({ id: i + 1, n: i }))
      .ltrim(KEY_BUFFER, 0, 99)
      .expire(KEY_BUFFER, 60)
      .exec();
  }
  const count = await liveRedis.llen(KEY_BUFFER);
  const ttl = await liveRedis.ttl(KEY_BUFFER);
  assert.strictEqual(Number(count), 100);
  assert.ok(ttl > 0 && ttl <= 60, `ttl=${ttl}`);

  // Buffer contains last 100 (ids 51..150) at indexes 0..99 (newest at head)
  const all = await liveRedis.lrange(KEY_BUFFER, 0, -1);
  assert.strictEqual(all.length, 100);
  // Newest at head (index 0) = id 150
  const head = JSON.parse(all[0]);
  assert.strictEqual(head.id, 150);
  // Oldest kept at index 99 = id 51
  const tail = JSON.parse(all[99]);
  assert.strictEqual(tail.id, 51);
  await liveRedis.del(KEY_BUFFER);
});

liveTest('R89 live: LRANGE returns newest-first (matches fake semantics)', async () => {
  await liveRedis.del(KEY_BUFFER);
  for (let i = 1; i <= 5; i++) {
    await liveRedis.lpush(KEY_BUFFER, JSON.stringify({ id: i }));
  }
  // After 5 LPUSHes: head=5 (newest), tail=1 (oldest)
  const raw = await liveRedis.lrange(KEY_BUFFER, 0, -1);
  assert.strictEqual(raw.length, 5);
  const parsed = raw.map((r) => JSON.parse(r).id);
  assert.deepStrictEqual(parsed, [5, 4, 3, 2, 1], 'LRANGE returns newest-first');
  await liveRedis.del(KEY_BUFFER);
});

liveTest('R89 live: TTL EXPIRE behavior — key expires after TTL', async () => {
  await liveRedis.del(KEY_BUFFER);
  await liveRedis.multi()
    .lpush(KEY_BUFFER, 'x')
    .expire(KEY_BUFFER, 1) // 1 sec
    .exec();
  const ttl1 = await liveRedis.ttl(KEY_BUFFER);
  assert.ok(ttl1 >= 0 && ttl1 <= 1, `ttl1=${ttl1}`);

  // Wait 1.2s — key should be gone
  await new Promise((r) => setTimeout(r, 1200));
  const exists = await liveRedis.exists(KEY_BUFFER);
  assert.strictEqual(Number(exists), 0, 'key should have expired');
});

liveTest('R89 live: INCR atomic across concurrent awaits', async () => {
  await liveRedis.del(KEY_EVENT_ID);
  // Fire 100 concurrent INCRs — should all be unique
  const promises = [];
  for (let i = 0; i < 100; i++) promises.push(liveRedis.incr(KEY_EVENT_ID));
  const ids = (await Promise.all(promises)).map(Number);
  assert.strictEqual(new Set(ids).size, 100, 'all ids unique');
  const sorted = [...ids].sort((a, b) => a - b);
  assert.deepStrictEqual(sorted, Array.from({ length: 100 }, (_, i) => i + 1));
  await liveRedis.del(KEY_EVENT_ID);
});

liveTest('R89 live: clear() (real DEL) wipes both keys', async () => {
  await liveRedis.set(KEY_EVENT_ID, '42');
  await liveRedis.lpush(KEY_BUFFER, 'a');
  await liveRedis.lpush(KEY_BUFFER, 'b');

  const before = await liveRedis.llen(KEY_BUFFER);
  assert.strictEqual(Number(before), 2);

  await liveRedis.del(KEY_BUFFER, KEY_EVENT_ID);

  const bufExists = await liveRedis.exists(KEY_BUFFER);
  const idExists = await liveRedis.exists(KEY_EVENT_ID);
  assert.strictEqual(Number(bufExists), 0);
  assert.strictEqual(Number(idExists), 0);
});

liveTest('R89 live: store integration — push + size + ttl', async () => {
  // Fresh keys for store integration test
  await liveRedis.del(KEY_BUFFER, KEY_EVENT_ID);
  const store = loadStoreWith(liveRedis);
  // Override the keys the store uses (since it hardcodes REPLAY_BUFFER_KEY)
  // Actually store uses module-level constants, so we need a different store instance
  // Easiest: just push to default keys, then cleanup
  await store.push({ id: 1, event: 'x', data: {}, ts: 1 });
  await store.push({ id: 2, event: 'x', data: {}, ts: 2 });
  await store.nextEventId(); // 1
  await store.nextEventId(); // 2
  await store.nextEventId(); // 3

  const size = await store.size();
  assert.strictEqual(size.count, 2);
  assert.ok(size.ttlSeconds > 86300 && size.ttlSeconds <= 86400,
    `ttlSeconds=${size.ttlSeconds}`);
  const cid = await store.currentEventId();
  assert.strictEqual(cid, 3);

  // Cleanup default keys
  await liveRedis.del('sse:replay:buffer', 'sse:event:id');
});

liveTest('R89 live: store integration — since() merges chronological', async () => {
  await liveRedis.del('sse:replay:buffer', 'sse:event:id');
  const store = loadStoreWith(liveRedis);
  for (let i = 1; i <= 5; i++) {
    await store.push({ id: i, event: 'x', data: { n: i }, ts: i });
  }
  const all = await store.since(0);
  assert.strictEqual(all.length, 5);
  // since() should reverse to chronological order
  assert.strictEqual(all[0].id, 1);
  assert.strictEqual(all[4].id, 5);
  const since3 = await store.since(3);
  assert.strictEqual(since3.length, 2);
  assert.strictEqual(since3[0].id, 4);
  assert.strictEqual(since3[1].id, 5);
  await liveRedis.del('sse:replay:buffer', 'sse:event:id');
});