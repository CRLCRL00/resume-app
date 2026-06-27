const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { userAuth } = require('../src/middleware/auth');
const { adminAuth } = require('../src/middleware/adminAuth');
const { sign } = require('../src/services/token');
const { errorHandler } = require('../src/middleware/errorHandler');
const pool = require('../src/config/db');

function makeApp() {
  const app = express();
  app.get('/admin-only', userAuth, adminAuth, (req, res) => {
    res.json({ code: 0 });
  });
  app.use(errorHandler);
  return app;
}

test('adminAuth allows admin user', async () => {
  const openid = 'test_admin_openid_' + Date.now();
  await pool.query('INSERT INTO admins (openid, note) VALUES (?, ?)', [openid, 'test']);

  const token = sign({ userId: 999, openid });
  const res = await request(makeApp())
    .get('/admin-only')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);

  await pool.query('DELETE FROM admins WHERE openid = ?', [openid]);
});

test('adminAuth rejects non-admin user', async () => {
  const token = sign({ userId: 1, openid: 'not_admin_' + Date.now() });
  const res = await request(makeApp())
    .get('/admin-only')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 1003);
});

test('GET /api/admin/check returns 401 without token', async () => {
  const res = await request(makeApp()).get('/admin-only');
  assert.equal(res.status, 401);
});

test.after(async () => {
  await pool.end();
});
