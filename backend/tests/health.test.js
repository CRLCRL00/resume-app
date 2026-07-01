const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

test('GET /api/health returns enriched shape', async () => {
  const app = createApp();
  const res = await request(app).get('/api/health');
  assert.ok([200, 503].includes(res.statusCode));
  assert.ok(res.body.data.status === 'ok' || res.body.data.status === 'degraded');
  assert.equal(res.body.code, res.statusCode === 200 ? 0 : 1503);
  assert.ok(typeof res.body.data.uptime === 'number');
  assert.ok(res.body.data.nodeVersion.startsWith('v'));
  assert.ok(typeof res.body.data.env === 'string');
  assert.ok(typeof res.body.data.version === 'string');
  assert.ok(typeof res.body.data.dbPingMs === 'number');
  assert.ok(typeof res.body.data.redisPingMs === 'number');
  assert.ok(res.body.data.db);
  assert.ok(res.body.data.redis);
});

test('GET /api/health/live always 200', async () => {
  const app = createApp();
  const res = await request(app).get('/api/health/live');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.code, 0);
  assert.equal(res.body.status, 'live');
  assert.ok(typeof res.body.uptime === 'number');
});

test('GET /api/health/ready returns 200 or 503 with db+redis', async () => {
  const app = createApp();
  const res = await request(app).get('/api/health/ready');
  assert.ok([200, 503].includes(res.statusCode));
  assert.ok(['ready', 'not_ready'].includes(res.body.status));
  assert.ok(['ok', 'down'].includes(res.body.db));
  assert.ok(['ok', 'down'].includes(res.body.redis));
});

test('GET /api/nonexistent returns 404', async () => {
  const app = createApp();
  const res = await request(app).get('/api/nonexistent');
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 1404);
});
