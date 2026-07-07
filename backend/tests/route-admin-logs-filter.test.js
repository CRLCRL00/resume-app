const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { sign } = require('../src/services/token');
const { getPool, cleanup } = require('./helpers/db');
const pool = getPool();

const ADMIN_OPENID = 'admin_phase9_filter_test';

// Use unique action/value prefixes to avoid colliding with real data
const TAG = `${ADMIN_OPENID}_${Date.now()}_${process.pid}`;

async function seed() {
  // Clean up any stale rows from prior runs
  await pool.query("DELETE FROM admin_operation_logs WHERE admin_openid LIKE ?", [`${TAG}%`]);
  await pool.query("DELETE FROM admins WHERE openid = ?", [ADMIN_OPENID]);
  await pool.query("INSERT INTO admins (openid, note) VALUES (?, 'phase9-filter-test')", [ADMIN_OPENID]);

  // Seed: admin.* action rows, distinct actions and actors
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const rows = [
    [TAG + '_actor_a', 'admin.login', 'success'],
    [TAG + '_actor_a', 'admin.logout', 'success'],
    [TAG + '_actor_a', 'admin.twofa.enable', 'success'],
    [TAG + '_actor_b', 'admin.login', 'failure'],
    [TAG + '_actor_b', 'admin.prompt.update', 'success'],
  ];
  for (const [actor, action, result] of rows) {
    await pool.query(
      `INSERT INTO admin_operation_logs (admin_openid, action, target_type, target_id, detail, result, ip, created_at)
       VALUES (?, ?, 'prompt', 'abc', '{}', ?, '10.0.0.1', ?)`,
      [actor, action, result, yesterday]
    );
  }
}

test.before(async () => {
  await seed();
});

test('GET /logs?action=admin filters by action prefix', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get(`/api/admin/logs?action=admin&pageSize=100`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  // Filter only by our seeded rows for assertion
  const items = res.body.data.items.filter((it) => it.admin_openid.startsWith(TAG));
  const actions = new Set(items.map((it) => it.action));
  assert.ok(actions.has('admin.login') || actions.has('admin.logout'), 'should include admin.* actions');
  // No non-admin.* actions among our rows
  for (const it of items) {
    assert.ok(it.action.startsWith('admin.'), `unexpected non-admin action: ${it.action}`);
  }
});

test('GET /logs?admin_openid=<actor> filters by that actor only', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const target = `${TAG}_actor_a`;
  const res = await request(createApp())
    .get(`/api/admin/logs?admin_openid=${encodeURIComponent(target)}&pageSize=100`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  const items = res.body.data.items.filter((it) => it.admin_openid.startsWith(TAG));
  assert.ok(items.length >= 3, `expected >=3 items, got ${items.length}`);
  for (const it of items) {
    assert.equal(it.admin_openid, target);
  }
});

test('GET /logs?result=success filters by result', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get(`/api/admin/logs?result=success&pageSize=100`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  const items = res.body.data.items.filter((it) => it.admin_openid.startsWith(TAG));
  for (const it of items) {
    assert.equal(it.result, 'success');
  }
});

test('GET /logs?dateFrom=<recent> returns only newer rows', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const today = new Date().toISOString();
  const res = await request(createApp())
    .get(`/api/admin/logs?dateFrom=${encodeURIComponent(today)}&pageSize=100`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  const cutoff = new Date(today).getTime();
  // Our seeded rows are yesterday — must NOT appear
  const items = res.body.data.items.filter((it) => it.admin_openid.startsWith(TAG));
  assert.equal(items.length, 0, 'yesterday rows should be filtered out by dateFrom=today');
});

test('GET /logs/actions returns distinct actions with counts', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get(`/api/admin/logs/actions`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data.items));
  // Each item has action + count
  for (const it of res.body.data.items) {
    assert.ok(typeof it.action === 'string');
    assert.ok(typeof it.count === 'number' || typeof it.count === 'string');
  }
});

test('GET /logs/actors returns distinct actors with counts', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get(`/api/admin/logs/actors`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data.items));
  // Each item has admin_openid + count
  for (const it of res.body.data.items) {
    assert.ok(typeof it.admin_openid === 'string');
    assert.ok(typeof it.count === 'number' || typeof it.count === 'string');
  }
  // Our two seeded actors must appear
  const openids = res.body.data.items.map((it) => it.admin_openid);
  assert.ok(openids.includes(`${TAG}_actor_a`));
  assert.ok(openids.includes(`${TAG}_actor_b`));
});

test.after(async () => {
  await pool.query("DELETE FROM admin_operation_logs WHERE admin_openid LIKE ?", [`${TAG}%`]);
  await pool.query("DELETE FROM admins WHERE openid = ?", [ADMIN_OPENID]);
  await cleanup();
});
