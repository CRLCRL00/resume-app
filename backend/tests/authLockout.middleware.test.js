const test = require('node:test');
const assert = require('node:assert');
const { isTest, checkLockout, recordFailure, clearFailures } = require('../src/middleware/authLockout');

test('isTest() true under npm test', () => {
  assert.strictEqual(isTest(), true);
});

test('checkLockout bypasses in test env', () => {
  let called = false;
  checkLockout({}, {}, () => { called = true; });
  assert.strictEqual(called, true);
});

test('recordFailure is no-op in test env', async () => {
  const r = await recordFailure({ ip: '1.2.3.4' });
  assert.strictEqual(r, undefined);
});

test('clearFailures is no-op in test env', async () => {
  await clearFailures({ ip: '1.2.3.4' });
  assert.ok(true);
});
