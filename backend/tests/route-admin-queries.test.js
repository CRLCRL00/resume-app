const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { sign } = require('../src/services/token');
const { getPool, cleanup } = require('./helpers/db');
const pool = getPool();
const queryMetrics = require('../src/services/queryMetrics');

const ADMIN_OPENID = 'admin_queries_test';
const USER_OPENID = 'non_admin_queries_test';

test.before(async () => {
  await pool.query("DELETE FROM admins WHERE openid = ?", [ADMIN_OPENID]);
  await pool.query("INSERT INTO admins (openid, note) VALUES (?, 'queries-test')", [ADMIN_OPENID]);
});

test('GET /api/admin/queries/slow without token returns 401', async () => {
  const res = await request(createApp()).get('/api/admin/queries/slow');
  assert.equal(res.status, 401);
});

test('GET /api/admin/queries/slow with non-admin returns 403', async () => {
  const token = sign({ userId: 1, openid: USER_OPENID });
  const res = await request(createApp())
    .get('/api/admin/queries/slow')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 403);
});

test('GET /api/admin/queries/slow returns recent slow queries', async () => {
  queryMetrics._resetForTests();
  queryMetrics.recordQuery({
    sql: 'SELECT * FROM users WHERE id = 1',
    durationMs: 350,
    operation: 'select',
    table: 'users',
  });
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get('/api/admin/queries/slow?limit=10')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data.items));
  assert.ok(res.body.data.items.length >= 1);
  assert.equal(res.body.data.items[0].table, 'users');
  assert.equal(res.body.data.items[0].operation, 'select');
  assert.ok(typeof res.body.data.items[0].durationMs === 'number');
  assert.ok(res.body.data.total >= 1);
});

test('GET /api/admin/queries/stats returns aggregated counts', async () => {
  queryMetrics._resetForTests();
  queryMetrics.recordQuery({ sql: 'SELECT 1', durationMs: 250, operation: 'select', table: 'users' });
  queryMetrics.recordQuery({ sql: 'SELECT 2', durationMs: 300, operation: 'select', table: 'jobs' });
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get('/api/admin/queries/stats')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.byTable.users, 1);
  assert.equal(res.body.data.byTable.jobs, 1);
  assert.equal(res.body.data.slowCount, 2);
  assert.ok(typeof res.body.data.slowQueryThresholdMs === 'number');
});

test.after(async () => {
  await pool.query("DELETE FROM admins WHERE openid = ?", [ADMIN_OPENID]);
  await cleanup();
});