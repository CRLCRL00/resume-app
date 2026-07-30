const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getRedis, cleanup } = require('./helpers/db');
const redis = getRedis();

test('redis can set and get', async () => {
  await redis.set('test:hello', 'world', 'EX', 10);
  const v = await redis.get('test:hello');
  assert.equal(v, 'world');
  await redis.del('test:hello');
});

test.after(async () => {
  await cleanup();
});