const test = require('node:test');
const assert = require('node:assert');
const { lockoutMiddleware, recordFailure, isLocked } = require('../src/middleware/authLockout');
const redis = require('../src/config/redis');

test('isLocked returns true after threshold', async () => {
  const ip = '203.0.113.99';
  const fakeReq = { ip, headers: {} };
  // cleanup
  await redis.del(`authfail:${ip}`, `authlock:${ip}`);
  const before = await isLocked(fakeReq);
  // bump counter
  for (let i = 0; i < 12; i++) await recordFailure(fakeReq);
  const after = await isLocked(fakeReq);
  assert.strictEqual(before, false);
  assert.strictEqual(after, true);
  // cleanup
  await redis.del(`authfail:${ip}`, `authlock:${ip}`);
});

test('lockoutMiddleware short-circuits when locked', async () => {
  const ip = '203.0.113.100';
  const fakeReq = { ip, headers: {} };
  // cleanup
  await redis.del(`authfail:${ip}`, `authlock:${ip}`);
  // pre-lock
  for (let i = 0; i < 11; i++) await recordFailure(fakeReq);
  let nextCalled = false;
  let resStatus = null;
  let resBody = null;
  const fakeRes = {
    status(c) { resStatus = c; return this; },
    json(b) { resBody = b; return this; }
  };
  await new Promise(resolve => {
    lockoutMiddleware(fakeReq, fakeRes, () => { nextCalled = true; resolve(); });
    // middleware either calls next() OR calls res.json(); give it a tick to resolve
    setImmediate(resolve);
  });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(resStatus, 423);
  assert.strictEqual(resBody.code, 423);
  // cleanup
  await redis.del(`authfail:${ip}`, `authlock:${ip}`);
});
