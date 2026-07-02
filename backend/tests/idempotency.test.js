const test = require('node:test');
const assert = require('node:assert');
const { idempotency, idempotencyCapture, captureBody } = require('../src/middleware/idempotency');

test('isTest bypasses', async () => {
  // test env → idempotency() is noop
  let called = false;
  const req = { headers: {}, user: { userId: 1 } };
  const res = { setHeader: () => {}, locals: {} };
  await idempotency()(req, res, () => { called = true; });
  assert.strictEqual(called, true);
});

test('captureBody intercepts res.json', () => {
  const req = { headers: {}, user: {} };
  const res = { locals: { __idemKey: 'test-key' }, json: () => {} };
  let calledWith = null;
  res.json = (body) => { calledWith = body; };
  captureBody()(req, res, () => {});
  res.json({ code: 0, data: { x: 1 } });
  assert.deepStrictEqual(calledWith, { code: 0, data: { x: 1 } });
});