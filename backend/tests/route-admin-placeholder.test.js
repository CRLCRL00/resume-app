const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { sign } = require('../src/services/token');
const { getPool, cleanup } = require('./helpers/db');
const pool = getPool();

test('GET /api/admin/check returns ok for admin', async () => {
  const openid = 'admin_check_test_' + Date.now();
  await pool.query('INSERT INTO admins (openid, note) VALUES (?, ?)', [openid, 'test']);

  const token = sign({ userId: 1, openid });
  const res = await request(createApp())
    .get('/api/admin/check')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.equal(res.body.data.isAdmin, true);

  await pool.query('DELETE FROM admins WHERE openid = ?', [openid]);
});

test('GET /api/admin/check returns 403 for non-admin', async () => {
  const token = sign({ userId: 1, openid: 'non_admin_' + Date.now() });
  const res = await request(createApp())
    .get('/api/admin/check')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 403);
});

test('GET /api/admin/check returns 401 without token', async () => {
  const res = await request(createApp()).get('/api/admin/check');
  assert.equal(res.status, 401);
});

test.after(async () => {
  await cleanup();
});
