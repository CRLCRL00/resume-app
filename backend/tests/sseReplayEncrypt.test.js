/**
 * R90-C: Encryption opt-in test (AES-256-GCM).
 *
 * Verifies:
 *   - Without SSE_REPLAY_KEY → plaintext (back-compat)
 *   - With valid key → encrypt + decrypt roundtrip works
 *   - Wrong key → decrypt fails, entry skipped
 *   - Invalid key format → disabled, plaintext passthrough
 *   - Tampered ciphertext → auth fails, entry skipped
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const Redis = require('ioredis');

// Generate a valid key once for tests
const VALID_KEY = crypto.randomBytes(32).toString('hex');
const INVALID_KEY_SHORT = 'abcd1234'; // too short
const WRONG_KEY = crypto.randomBytes(32).toString('hex');

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
      retryStrategy: () => null,
    });
    await liveRedis.connect();
    await liveRedis.ping();
    liveRedisOk = true;
  } catch (_) {
    liveRedisOk = false;
    if (liveRedis) { liveRedis.disconnect(); liveRedis = null; }
  }
  return liveRedisOk;
}

const RUN_ID = `r90c-${process.pid}-${Date.now()}`;
const KEY_BUFFER = `test:${RUN_ID}:sse:replay:buffer`;
const KEY_EVENT_ID = `test:${RUN_ID}:sse:event:id`;

function loadStoreWith(realRedis, env) {
  if (env) {
    if (env.SSE_REPLAY_KEY === undefined) delete process.env.SSE_REPLAY_KEY;
    else process.env.SSE_REPLAY_KEY = env.SSE_REPLAY_KEY;
  }
  const storePath = require.resolve('../src/db/sseReplayStore');
  delete require.cache[storePath];
  require.cache[require.resolve('../src/config/redis')] = {
    id: require.resolve('../src/config/redis'),
    filename: require.resolve('../src/config/redis'),
    loaded: true,
    exports: realRedis,
  };
  return require(storePath);
}

test.before(async () => {
  await tryConnect();
});

test.after(async () => {
  if (liveRedis && liveRedisOk) {
    try {
      await liveRedis.del(KEY_BUFFER, KEY_EVENT_ID);
    } catch (_) {}
    liveRedis.disconnect();
  }
  delete process.env.SSE_REPLAY_KEY;
});

function liveTest(name, fn) {
  test(name, async () => {
    if (!liveRedisOk) return; // skip silently
    await fn();
  });
}

// ─── Plaintext mode (no key) ───────────────────────────────
liveTest('R90-C: no SSE_REPLAY_KEY → plaintext passthrough', async () => {
  const store = loadStoreWith(liveRedis, { SSE_REPLAY_KEY: undefined });
  await liveRedis.del(KEY_BUFFER, KEY_EVENT_ID);
  // store writes to default keys — overwrite them for isolation
  await liveRedis.del('sse:replay:buffer', 'sse:event:id');
  await store.push({ id: 1, event: 'plain', data: { city: 'Beijing' }, ts: 1 });
  const raw = await liveRedis.lrange('sse:replay:buffer', 0, -1);
  // Raw value should be readable JSON, not base64 ciphertext
  assert.strictEqual(raw.length, 1);
  const obj = JSON.parse(raw[0]);
  assert.strictEqual(obj.data.city, 'Beijing');
  await liveRedis.del('sse:replay:buffer', 'sse:event:id');
});

// ─── Encrypted mode ────────────────────────────────────────
liveTest('R90-C: with key → encrypt roundtrip', async () => {
  const store = loadStoreWith(liveRedis, { SSE_REPLAY_KEY: VALID_KEY });
  await liveRedis.del('sse:replay:buffer', 'sse:event:id');
  await store.push({ id: 1, event: 'secret', data: { city: 'Shanghai', salary: 30000 }, ts: 1 });
  await store.push({ id: 2, event: 'secret', data: { city: 'Shenzhen' }, ts: 2 });

  // Read raw from Redis — should be base64 ciphertext, NOT readable JSON
  const raw = await liveRedis.lrange('sse:replay:buffer', 0, -1);
  assert.strictEqual(raw.length, 2);
  for (const v of raw) {
    // Should NOT be valid JSON
    assert.throws(() => JSON.parse(v), 'encrypted value should not be plain JSON');
    // Should be valid base64
    assert.doesNotThrow(() => Buffer.from(v, 'base64'));
    // Decoded length: iv(12) + tag(16) + ciphertext(min 1)
    const decoded = Buffer.from(v, 'base64');
    assert.ok(decoded.length >= 29, `decoded too short: ${decoded.length}`);
  }

  // since() should decrypt and return plaintext events
  const all = await store.since(0);
  assert.strictEqual(all.length, 2);
  assert.strictEqual(all[0].data.city, 'Shanghai'); // oldest first (reversed)
  assert.strictEqual(all[1].data.city, 'Shenzhen');
  await liveRedis.del('sse:replay:buffer', 'sse:event:id');
});

liveTest('R90-C: since() filters by id after decrypt', async () => {
  const store = loadStoreWith(liveRedis, { SSE_REPLAY_KEY: VALID_KEY });
  await liveRedis.del('sse:replay:buffer', 'sse:event:id');
  for (let i = 1; i <= 5; i++) {
    await store.push({ id: i, event: 'x', data: { i }, ts: i });
  }
  const since3 = await store.since(3);
  assert.strictEqual(since3.length, 2);
  assert.strictEqual(since3[0].id, 4);
  assert.strictEqual(since3[1].id, 5);
  await liveRedis.del('sse:replay:buffer', 'sse:event:id');
});

liveTest('R90-C: wrong key → decrypt fails, entry skipped (no crash)', async () => {
  // Push with key A
  const storeA = loadStoreWith(liveRedis, { SSE_REPLAY_KEY: VALID_KEY });
  await liveRedis.del('sse:replay:buffer', 'sse:event:id');
  await storeA.push({ id: 1, event: 'x', data: { secret: 'A' }, ts: 1 });
  await storeA.push({ id: 2, event: 'x', data: { secret: 'B' }, ts: 2 });

  // Read with wrong key B
  const storeB = loadStoreWith(liveRedis, { SSE_REPLAY_KEY: WRONG_KEY });
  const all = await storeB.since(0);
  // Both entries should be skipped (auth fails on wrong key)
  assert.strictEqual(all.length, 0, 'wrong key should skip all encrypted entries');
  await liveRedis.del('sse:replay:buffer', 'sse:event:id');
});

liveTest('R90-C: invalid key format → encryption disabled, plaintext', async () => {
  const store = loadStoreWith(liveRedis, { SSE_REPLAY_KEY: INVALID_KEY_SHORT });
  await liveRedis.del('sse:replay:buffer', 'sse:event:id');
  await store.push({ id: 1, event: 'x', data: { a: 1 }, ts: 1 });
  const raw = await liveRedis.lrange('sse:replay:buffer', 0, -1);
  // Should fallback to plaintext (invalid key → disabled)
  assert.strictEqual(raw.length, 1);
  const obj = JSON.parse(raw[0]);
  assert.strictEqual(obj.data.a, 1);
  await liveRedis.del('sse:replay:buffer', 'sse:event:id');
});

liveTest('R90-C: tampered ciphertext → skipped (GCM auth fails)', async () => {
  const store = loadStoreWith(liveRedis, { SSE_REPLAY_KEY: VALID_KEY });
  await liveRedis.del('sse:replay:buffer', 'sse:event:id');
  await store.push({ id: 1, event: 'x', data: { v: 1 }, ts: 1 });

  // Tamper the ciphertext in Redis
  const raw = await liveRedis.lrange('sse:replay:buffer', 0, -1);
  const buf = Buffer.from(raw[0], 'base64');
  // Flip a bit in the ciphertext area (after iv+tag, so index 28+)
  if (buf.length > 28) {
    buf[buf.length - 1] = buf[buf.length - 1] ^ 0x01;
  }
  const tampered = buf.toString('base64');
  await liveRedis.lset('sse:replay:buffer', 0, tampered);

  const all = await store.since(0);
  // Tampered entry should be skipped (GCM auth fails)
  assert.strictEqual(all.length, 0, 'tampered ciphertext should be skipped');
  await liveRedis.del('sse:replay:buffer', 'sse:event:id');
});

liveTest('R90-C: mixed plaintext+encrypted → since handles both gracefully', async () => {
  // Push plaintext first (no key)
  const storePlain = loadStoreWith(liveRedis, { SSE_REPLAY_KEY: undefined });
  await liveRedis.del('sse:replay:buffer', 'sse:event:id');
  await storePlain.push({ id: 1, event: 'plain', data: { a: 1 }, ts: 1 });

  // Switch to encrypted mode and push more
  const storeEnc = loadStoreWith(liveRedis, { SSE_REPLAY_KEY: VALID_KEY });
  await storeEnc.push({ id: 2, event: 'enc', data: { b: 2 }, ts: 2 });

  // Read with encrypted mode: plaintext entry will fail decrypt, encrypted OK
  const all = await storeEnc.since(0);
  // Only the encrypted one should come through (plaintext skipped due to decrypt fail)
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].id, 2);
  assert.strictEqual(all[0].data.b, 2);
  await liveRedis.del('sse:replay:buffer', 'sse:event:id');
});