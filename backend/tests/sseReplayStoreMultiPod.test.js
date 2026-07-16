/**
 * R88: Multi-pod shared buffer verify (event id uniqueness + replay merge)
 *
 * Simulates 2 pods sharing Redis by injecting a shared in-process fake.
 * Verifies:
 *   - INCR is atomic across "pods" (no duplicate ids)
 *   - LPUSH+LTRIM+EXPIRE work as expected
 *   - since() merges events from both pods chronologically
 *   - clear() wipes both id counter and buffer
 *
 * Why in-process fake instead of ioredis-mock:
 *   - We only need INCR + LPUSH/LTRIM/LRANGE/LLEN/DEL/EXPIRE/TTL — small surface
 *   - No new dep, deterministic, fast (no real Redis needed in CI)
 *
 * Multi-pod semantics emulated:
 *   - Two callers share the same fake instance (= shared Redis)
 *   - Each caller's `nextEventId()` increments the same atomic counter
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

// ───────────────────────────────────────────────────────────────
// Fake Redis — INCR + LIST ops
// ───────────────────────────────────────────────────────────────
function makeFakeRedis() {
  const kv = new Map(); // string keys
  const lists = new Map(); // list keys → array
  const ttls = new Map(); // string keys → ms timestamp when key expires
  return {
    async incr(key) {
      const v = (Number(kv.get(key)) || 0) + 1;
      kv.set(key, String(v));
      // INCR also resets TTL (treat like a touch)
      return v;
    },
    async get(key) {
      const exp = ttls.get(key);
      if (exp && Date.now() > exp) {
        kv.delete(key);
        ttls.delete(key);
        return null;
      }
      return kv.has(key) ? kv.get(key) : null;
    },
    async set(key, val) { kv.set(key, val); return 'OK'; },
    async del(...keys) {
      let n = 0;
      for (const k of keys) {
        if (kv.delete(k)) n++;
        if (lists.delete(k)) n++;
        ttls.delete(k);
      }
      return n;
    },
    async expire(key, sec) {
      if (!kv.has(key) && !lists.has(key)) return 0;
      ttls.set(key, Date.now() + sec * 1000);
      return 1;
    },
    async ttl(key) {
      if (!kv.has(key) && !lists.has(key)) return -2;
      const exp = ttls.get(key);
      if (!exp) return -1; // no TTL set
      const ms = exp - Date.now();
      return ms > 0 ? Math.ceil(ms / 1000) : -2;
    },
    async lpush(key, ...vals) {
      let list = lists.get(key);
      if (!list) { list = []; lists.set(key, list); }
      list.unshift(...vals); // newest at head
      return list.length;
    },
    async ltrim(key, start, stop) {
      const list = lists.get(key);
      if (!list) return 'OK';
      // Redis semantics: negative stop means from end
      const s = start < 0 ? Math.max(0, list.length + start) : start;
      const e = stop < 0 ? list.length + stop : stop;
      lists.set(key, list.slice(s, e + 1));
      return 'OK';
    },
    async lrange(key, start, stop) {
      const list = lists.get(key);
      if (!list) return [];
      const s = start < 0 ? Math.max(0, list.length + start) : start;
      const e = stop < 0 ? list.length + stop : stop;
      return list.slice(s, e + 1);
    },
    async llen(key) {
      const list = lists.get(key);
      return list ? list.length : 0;
    },
    multi() {
      const self = this;
      const ops = [];
      const tx = {
        lpush(key, ...vals) { ops.push(['lpush', key, vals]); return tx; },
        ltrim(key, s, e) { ops.push(['ltrim', key, s, e]); return tx; },
        expire(key, sec) { ops.push(['expire', key, sec]); return tx; },
        async exec() {
          const results = [];
          for (const op of ops) {
            const [m, ...args] = op;
            results.push([null, await self[m](...args)]);
          }
          return results;
        },
      };
      return tx;
    },
    _raw: { kv, lists, ttls }, // test introspection
  };
}

// ───────────────────────────────────────────────────────────────
// Inject fake into sseReplayStore via require cache swap
// ───────────────────────────────────────────────────────────────
function loadStoreWith(fake) {
  // Reset require cache for store so it re-requires redis with our fake
  const storePath = require.resolve('../src/db/sseReplayStore');
  delete require.cache[storePath];
  // Stub config/redis to export our fake directly
  // (store calls getRedis() → require('../config/redis') → module.exports = fake)
  require.cache[require.resolve('../src/config/redis')] = {
    id: require.resolve('../src/config/redis'),
    filename: require.resolve('../src/config/redis'),
    loaded: true,
    exports: fake,
  };
  return require(storePath);
}

// ───────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────
test('R88: single-pod sequential INCR produces unique monotonic ids', async () => {
  const fake = makeFakeRedis();
  const store = loadStoreWith(fake);
  const ids = [];
  for (let i = 0; i < 50; i++) ids.push(await store.nextEventId());
  assert.deepStrictEqual(ids, Array.from({ length: 50 }, (_, i) => i + 1));
});

test('R88: two pods share the same counter (no overlap, atomic)', async () => {
  const fake = makeFakeRedis();
  const storeA = loadStoreWith(fake);
  const storeB = loadStoreWith(fake);

  // Interleave calls as if 2 pods racing
  const allIds = [];
  for (let i = 0; i < 100; i++) {
    const store = i % 2 === 0 ? storeA : storeB;
    allIds.push(await store.nextEventId());
  }
  // All unique
  assert.strictEqual(new Set(allIds).size, 100);
  // Monotonically increasing (no specific order, but no duplicates)
  const sorted = [...allIds].sort((a, b) => a - b);
  assert.deepStrictEqual(sorted, Array.from({ length: 100 }, (_, i) => i + 1));
});

test('R88: push from 2 pods merged into one chronological buffer', async () => {
  const fake = makeFakeRedis();
  const storeA = loadStoreWith(fake);
  const storeB = loadStoreWith(fake);

  // pod A pushes 5 events with ids 1..5
  for (let i = 1; i <= 5; i++) {
    const id = await storeA.nextEventId();
    await storeA.push({ id, event: 'fromA', data: { tag: 'A', n: id }, ts: Date.now() });
  }
  // pod B pushes 5 events with ids 6..10
  for (let i = 0; i < 5; i++) {
    const id = await storeB.nextEventId();
    await storeB.push({ id, event: 'fromB', data: { tag: 'B', n: id }, ts: Date.now() });
  }

  const since5 = await storeA.since(5);
  assert.strictEqual(since5.length, 5);
  // All from B
  for (const e of since5) assert.strictEqual(e.data.tag, 'B');
  // Chronological order
  for (let i = 1; i < since5.length; i++) {
    assert.ok(since5[i].id > since5[i - 1].id, `id order broken at ${i}`);
  }

  const since0 = await storeA.since(0);
  assert.strictEqual(since0.length, 10);
  // First 5 from A, last 5 from B
  for (let i = 0; i < 5; i++) assert.strictEqual(since0[i].data.tag, 'A');
  for (let i = 5; i < 10; i++) assert.strictEqual(since0[i].data.tag, 'B');
});

test('R88: TTL rolling — every push resets 24h', async () => {
  const fake = makeFakeRedis();
  const store = loadStoreWith(fake);

  await store.push({ id: 1, event: 'x', data: {}, ts: 1 });
  const ttl1 = (await store.size()).ttlSeconds;
  assert.ok(ttl1 > 86000 && ttl1 <= 86400, `ttl1=${ttl1}`);

  // Simulate ~1s passing (fake uses real time)
  await new Promise((r) => setTimeout(r, 1100));
  await store.push({ id: 2, event: 'x', data: {}, ts: 2 });
  const ttl2 = (await store.size()).ttlSeconds;
  // Should be ≈ 86400 again (rolling)
  assert.ok(ttl2 > 86398 && ttl2 <= 86400, `ttl2 after reset=${ttl2}`);
});

test('R88: cap=100 holds even with concurrent pushes from 2 pods', async () => {
  const fake = makeFakeRedis();
  const storeA = loadStoreWith(fake);
  const storeB = loadStoreWith(fake);

  // 200 interleaved pushes
  for (let i = 0; i < 200; i++) {
    const store = i % 2 === 0 ? storeA : storeB;
    const id = await store.nextEventId();
    await store.push({ id, event: 'x', data: { i }, ts: Date.now() });
  }

  const { count, ttlSeconds } = await storeA.size();
  assert.strictEqual(count, 100);
  assert.ok(ttlSeconds > 0);

  // Buffer should contain the LAST 100 ids (101..200)
  const all = await storeA.since(0);
  assert.strictEqual(all.length, 100);
  assert.strictEqual(all[0].id, 101);
  assert.strictEqual(all[99].id, 200);
});

test('R88: clear() wipes both buffer and event id counter', async () => {
  const fake = makeFakeRedis();
  const store = loadStoreWith(fake);

  await store.push({ id: 1, event: 'x', data: {}, ts: 1 });
  await store.push({ id: 2, event: 'x', data: {}, ts: 2 });
  await store.nextEventId(); // = 3
  await store.nextEventId(); // = 4

  const before = (await store.size()).count;
  assert.strictEqual(before, 2);

  await store.clear();

  const after = await store.size();
  assert.strictEqual(after.count, 0);
  assert.strictEqual(after.ttlSeconds, null);

  // next event id starts fresh at 1
  const nextId = await store.nextEventId();
  assert.strictEqual(nextId, 1);
});

test('R88: currentEventId returns latest counter (for ops)', async () => {
  const fake = makeFakeRedis();
  const store = loadStoreWith(fake);

  assert.strictEqual(await store.currentEventId(), null);
  await store.nextEventId(); // 1
  await store.nextEventId(); // 2
  assert.strictEqual(await store.currentEventId(), 2);
  await store.nextEventId(); // 3
  assert.strictEqual(await store.currentEventId(), 3);
});

test('R88: fallback path — Redis down triggers local fallback', async () => {
  const fake = makeFakeRedis();
  const store = loadStoreWith(fake);

  // Push 3 events OK
  await store.push({ id: 1, event: 'x', data: { n: 1 }, ts: 1 });
  await store.push({ id: 2, event: 'x', data: { n: 2 }, ts: 2 });
  await store.push({ id: 3, event: 'x', data: { n: 3 }, ts: 3 });

  // Simulate Redis failure on next push
  fake.lpush = async () => { throw new Error('redis down'); };

  const ok = await store.push({ id: 4, event: 'x', data: { n: 4 }, ts: 4 });
  assert.strictEqual(ok, false); // returns false on fallback

  // since() with Redis down returns from fallback
  fake.lrange = async () => { throw new Error('redis down'); };
  const fb = await store.since(0);
  // Should still have at least the fallback-buffered event (id=4)
  assert.ok(fb.length >= 1, `fallback length=${fb.length}`);
  const fbIds = fb.map((e) => e.id);
  assert.ok(fbIds.includes(4), 'fallback should contain id=4');
});