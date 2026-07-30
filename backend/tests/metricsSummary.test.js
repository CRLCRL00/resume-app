const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');

test('GET /api/internal/metrics/summary returns JSON', async () => {
  const app = createApp();
  const res = await request(app).get('/api/internal/metrics/summary');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.code, 0);
  assert.ok(res.body.data.generatedAt);
  assert.ok(res.body.data.counters);
  assert.ok(res.body.data.gauges);
});
