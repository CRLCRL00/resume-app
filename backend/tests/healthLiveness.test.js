const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');

test('GET /api/health/live is 200 always', async () => {
  const app = createApp();
  const res = await request(app).get('/api/health/live');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.status, 'live');
});

test('GET /api/health/ready returns db/redis status', async () => {
  const app = createApp();
  const res = await request(app).get('/api/health/ready');
  // test env may or may not have DB/Redis; accept either 200 or 503
  assert.ok([200, 503].includes(res.statusCode));
  assert.ok(['ready', 'not_ready'].includes(res.body.status));
  assert.ok(['ok', 'down'].includes(res.body.db));
});
