const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

test('GET /api/health returns 200 with status ok', async () => {
  const app = createApp();
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.equal(res.body.data.status, 'ok');
  assert.ok(res.body.data.timestamp, 'should include timestamp');
});

test('GET /api/health on unknown route returns 404', async () => {
  const app = createApp();
  const res = await request(app).get('/api/nonexistent');
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 1404);
});