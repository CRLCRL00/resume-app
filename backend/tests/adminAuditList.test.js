const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');
const { sign } = require('../src/services/token');
const { getPool } = require('./helpers/db');

const ADMIN_OPENID = 'admin_audit_list_test_' + Date.now();

test('setup: insert admin + seed audit rows', async () => {
  const pool = getPool();
  await pool.query("INSERT IGNORE INTO admins (openid) VALUES (?)", [ADMIN_OPENID]);
  // Seed a few audit rows for this openid
  for (let i = 0; i < 3; i++) {
    await pool.query(
      `INSERT INTO admin_audit (openid, action, target_type, target_id, method, path, ip, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [ADMIN_OPENID, `POST /api/admin/jobs/test${i}`, 'jobs', String(i), 'POST', `/api/admin/jobs/test${i}`, '127.0.0.1', 200]
    );
  }
});

test('GET /api/admin/audit requires admin auth', async () => {
  const res = await request(createApp()).get('/api/admin/audit');
  assert.strictEqual(res.statusCode, 401);
});

test('GET /api/admin/audit returns list with pagination', async () => {
  const token = sign({ openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get('/api/admin/audit?openid=' + ADMIN_OPENID + '&limit=10')
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.code, 0);
  assert.ok(res.body.data.rows.length >= 3);
  assert.ok(res.body.data.total >= 3);
  assert.strictEqual(res.body.data.limit, 10);
});

test('GET /api/admin/audit filter by action prefix', async () => {
  const token = sign({ openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get(`/api/admin/audit?openid=${ADMIN_OPENID}&action=POST /api/admin/jobs`)
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.data.rows.every(r => r.action.startsWith('POST /api/admin/jobs')));
});

test('GET /api/admin/audit limit capped at 200', async () => {
  const token = sign({ openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get('/api/admin/audit?limit=999')
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.data.limit, 200);
});

test.after(async () => {
  const pool = getPool();
  await pool.query("DELETE FROM admin_audit WHERE openid = ?", [ADMIN_OPENID]);
  await pool.query("DELETE FROM admins WHERE openid = ?", [ADMIN_OPENID]);
  await pool.end();
});