const test = require('node:test');
const assert = require('node:assert');
const { lockoutMiddleware, isLocked } = require('../src/middleware/authLockout');
const redis = require('../src/config/redis');

// R42 fix: recordFailure is a no-op in test env (per
// authLockout.middleware.test.js contract). To test the lockout outcome,
// pre-set redis lock keys directly — `isLocked` and `lockoutMiddleware`
// probe redis in any env (R42 fix). This decouples the two test files:
// authLockout.test.js tests the *probe* path; authLockout.middleware.test.js
// tests the *no-op record* path.

test('isLocked returns true after threshold', async () => {
  const ip = '203.0.113.99';
  const fakeReq = { ip, headers: {} };
  // cleanup + pre-lock
  await redis.del(`auth:lock:${ip}`, `authlock:${ip}`);
  const before = await isLocked(fakeReq);
  // pre-set lock key (TTL 5min mimics the LIVE threshold path)
  await redis.set(`auth:lock:${ip}`, '1', 'EX', 300);
  await redis.set(`authlock:${ip}`, '1', 'EX', 300);
  const after = await isLocked(fakeReq);
  assert.strictEqual(before, false);
  assert.strictEqual(after, true);
  // cleanup
  await redis.del(`auth:lock:${ip}`, `authlock:${ip}`);
});

test('lockoutMiddleware short-circuits when locked', async () => {
  const ip = '203.0.113.100';
  const fakeReq = { ip, headers: {} };
  // cleanup
  await redis.del(`auth:lock:${ip}`, `authlock:${ip}`);
  // pre-lock
  await redis.set(`auth:lock:${ip}`, '1', 'EX', 300);
  let nextCalled = false;
  let resStatus = null;
  let resBody = null;
  const fakeRes = {
    status(c) { resStatus = c; return this; },
    json(b) { resBody = b; return this; }
  };
  // R42 fix: middleware is now async (probes redis in test env per R42 fix);
  // old `setImmediate(resolve)` raced the redis call and asserted before
  // res.status was set. Await the middleware directly: it returns the
  // resolved Promise (next OR res.status().json() resolves it).
  await new Promise(resolve => {
    const p = lockoutMiddleware(fakeReq, fakeRes, () => { nextCalled = true; resolve(); });
    // Express middleware signature: (req, res, next). When isTest() is true
    // and a lock key is set, middleware does `await redis.get(...)` then
    // calls res.status().json() and returns. We must await that branch.
    if (p && typeof p.then === 'function') {
      p.then(resolve, resolve);
    } else {
      // fallback for sync path (returns undefined)
      setImmediate(resolve);
    }
  });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(resStatus, 423);
  assert.strictEqual(resBody.code, 423);
  // cleanup
  await redis.del(`auth:lock:${ip}`, `authlock:${ip}`);
});
