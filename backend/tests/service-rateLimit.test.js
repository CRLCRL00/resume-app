const { test } = require('node:test');
const assert = require('node:assert/strict');
const redis = require('../src/config/redis');
const { check } = require('../src/services/rateLimit');
const { cleanup } = require('./helpers/db');

const key = 'test:rl:' + Date.now();

test('check allows under limit', async () => {
  await redis.del(key);
  const r1 = await check(key, 4, 60);
  const r2 = await check(key, 4, 60);
  assert.equal(r1.allowed, true);
  assert.equal(r2.allowed, true);
  assert.equal(r1.count, 1);
  assert.equal(r2.count, 2);
  assert.equal(r2.remaining, 2);
});

test('check blocks over limit', async () => {
  await redis.del(key);
  await check(key, 2, 60);  // 1
  await check(key, 2, 60);  // 2
  const r3 = await check(key, 2, 60);  // 3
  assert.equal(r3.allowed, false);
  assert.equal(r3.count, 3);
  assert.equal(r3.remaining, 0);
});

test('check sets TTL on first increment', async () => {
  const k = 'test:rl:ttl:' + Date.now();
  await redis.del(k);
  await check(k, 5, 60);
  const ttl = await redis.ttl(k);
  assert.ok(ttl > 0 && ttl <= 60, `TTL should be ~60, got ${ttl}`);
});

test('check fails open on redis error', async () => {
  const orig = redis.incr;
  redis.incr = async () => { throw new Error('redis down'); };
  const r = await check('any:key', 4, 60);
  assert.equal(r.allowed, true);
  assert.equal(r.count, 0);
  redis.incr = orig;
});

test.after(async () => {
  await redis.del(key);
  await cleanup();
});