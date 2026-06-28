const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { sign } = require('../src/services/token');
const pool = require('../src/config/db');

const ADMIN_OPENID = 'admin_phase4_log_test';

test.before(async () => {
  await pool.query("DELETE FROM admins WHERE openid = ?", [ADMIN_OPENID]);
  await pool.query("INSERT INTO admins (openid, note) VALUES (?, 'phase4-log-test')", [ADMIN_OPENID]);
  await pool.query("DELETE FROM admin_operation_logs WHERE admin_openid = ?", [ADMIN_OPENID]);
  await pool.query(
    "INSERT INTO admin_operation_logs (admin_openid, action, target_type, target_id, detail) VALUES (?, 'test.action', 'job', '1', '{}')",
    [ADMIN_OPENID]
  );
});

test('GET /api/admin/logs without token returns 401', async () => {
  const res = await request(createApp()).get('/api/admin/logs');
  assert.equal(res.status, 401);
});

test('GET /api/admin/logs with non-admin returns 403', async () => {
  const token = sign({ userId: 1, openid: 'non_admin_xxx' });
  const res = await request(createApp())
    .get('/api/admin/logs')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 403);
});

test('GET /api/admin/logs lists logs with pagination', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get('/api/admin/logs?page=1&pageSize=10')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data.items));
  assert.ok(res.body.data.items.length >= 1);
  assert.equal(res.body.data.items[0].action, 'test.action');
});

test('GET /api/admin/logs returns latest first', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get('/api/admin/logs?pageSize=50')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  // 倒序：第一条的 created_at 应 >= 最后一条
  const items = res.body.data.items;
  if (items.length >= 2) {
    const first = new Date(items[0].created_at).getTime();
    const last = new Date(items[items.length - 1].created_at).getTime();
    assert.ok(first >= last, 'should be sorted desc');
  }
});

test.after(async () => {
  await pool.query("DELETE FROM admin_operation_logs WHERE admin_openid = ?", [ADMIN_OPENID]);
  await pool.query("DELETE FROM admins WHERE openid = ?", [ADMIN_OPENID]);
  await pool.end();
});