const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { sign } = require('../src/services/token');
const { getPool, cleanup } = require('./helpers/db');

const ADMIN_OPENID = 'admin_audit_test_openid';

test.before(async () => {
  const pool = getPool();
  await pool.query("DELETE FROM admins WHERE openid = ?", [ADMIN_OPENID]);
  await pool.query("INSERT INTO admins (openid, note) VALUES (?, 'audit-test')", [ADMIN_OPENID]);
});

test('admin POST /api/admin/jobs writes admin_audit row', async () => {
  const pool = getPool();
  const app = createApp();
  const jwt = sign({ userId: 999, openid: ADMIN_OPENID });
  const [before] = await pool.query('SELECT COUNT(*) AS c FROM admin_audit');
  const res = await request(app)
    .post('/api/admin/jobs')
    .set('Authorization', `Bearer ${jwt}`)
    .send({ title: 'audit-test', description_md: 'x', company: 'y', city: '深圳', salary_min: 10, salary_max: 20 });
  // Either 200 (create) or 400 (validation) — both should be audited
  assert.ok([200, 400, 403].includes(res.status));
  // give res.on('finish') handler a moment to run
  await new Promise(r => setTimeout(r, 200));
  const [after] = await pool.query('SELECT COUNT(*) AS c FROM admin_audit');
  assert.ok(Number(after[0].c) > Number(before[0].c), 'audit row must be inserted');
});

test.after(async () => {
  const pool = getPool();
  await pool.query("DELETE FROM admin_audit WHERE openid = ?", [ADMIN_OPENID]);
  await pool.query("DELETE FROM admins WHERE openid = ?", [ADMIN_OPENID]);
  await cleanup();
});