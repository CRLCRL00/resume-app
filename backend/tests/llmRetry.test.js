const test = require('node:test');
const assert = require('node:assert/strict');
const { withRetry, retriesTotal } = require('../src/services/llm');

test('withRetry retries on network error then succeeds', async () => {
  let attempts = 0;
  const fn = async () => {
    attempts += 1;
    if (attempts < 3) {
      const e = new Error('ECONNREFUSED');
      e.code = 'ECONNREFUSED';
      throw e;
    }
    return { data: { ok: true } };
  };
  const res = await withRetry('test.retry', fn);
  assert.equal(attempts, 3);
  assert.equal(res.data.ok, true);
});

test('withRetry gives up after max retries and surfaces 502', async () => {
  let attempts = 0;
  const fn = async () => {
    attempts += 1;
    const e = new Error('always fail');
    e.code = 'ECONNREFUSED';
    throw e;
  };
  let caught = null;
  try {
    await withRetry('test.exhaust', fn);
  } catch (e) {
    caught = e;
  }
  assert.equal(attempts, 3);
  assert.equal(caught.statusCode, 502);
  assert.ok(caught.cause, 'should preserve original cause');
});

test('withRetry does NOT retry on 4xx (client error)', async () => {
  let attempts = 0;
  const fn = async () => {
    attempts += 1;
    const e = new Error('bad request');
    e.isAxiosError = true;
    e.response = { status: 400, data: { error: { message: 'bad' } } };
    throw e;
  };
  let caught = null;
  try {
    await withRetry('test.4xx', fn);
  } catch (e) {
    caught = e;
  }
  assert.equal(attempts, 1);
  assert.equal(caught.statusCode, 502);
});