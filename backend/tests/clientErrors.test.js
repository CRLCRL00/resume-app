const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

test('POST /api/internal/client-errors: valid payload → 200 + id returned', async () => {
  const r = await request(createApp())
    .post('/api/internal/client-errors')
    .send({
      openid: 'test-openid-001',
      version: '1.0.0',
      platform: 'devtools',
      errorType: 'app_onerror',
      message: 'something blew up',
      stack: 'Error: something blew up\n  at x.js:1:1',
      url: '/pages/index/index',
      metadata: { requestId: 'abc-123' },
    });
  assert.equal(r.status, 200);
  assert.equal(r.body.code, 0);
  assert.ok(r.body.data && r.body.data.id, 'id should be present');
});

test('POST /api/internal/client-errors: missing errorType → 400', async () => {
  const r = await request(createApp())
    .post('/api/internal/client-errors')
    .send({ message: 'boom' });
  assert.equal(r.status, 400);
});

test('POST /api/internal/client-errors: missing message → 400', async () => {
  const r = await request(createApp())
    .post('/api/internal/client-errors')
    .send({ errorType: 'app_onerror' });
  assert.equal(r.status, 400);
});

test('POST /api/internal/client-errors: oversized stack (>32KB) → 400', async () => {
  const bigStack = 'a'.repeat(33 * 1024); // 33 KB
  const r = await request(createApp())
    .post('/api/internal/client-errors')
    .send({
      errorType: 'app_onerror',
      message: 'big stack',
      stack: bigStack,
    });
  assert.equal(r.status, 400);
});