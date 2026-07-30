const test = require('node:test');
const assert = require('node:assert');
const { getRequestId, getContext } = require('../src/middleware/requestContext');

test('getRequestId outside context returns null', () => {
  assert.strictEqual(getRequestId(), null);
});

test('inside storage.run, getRequestId returns the id', () => {
  const { storage } = require('../src/middleware/requestContext');
  storage.run({ requestId: 'abc-123', startTime: 0 }, () => {
    assert.strictEqual(getRequestId(), 'abc-123');
    const ctx = getContext();
    assert.strictEqual(ctx.requestId, 'abc-123');
  });
});