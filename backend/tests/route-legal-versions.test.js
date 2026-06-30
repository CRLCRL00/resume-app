const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const mysql = require('mysql2/promise');

const ADMIN_OPENID = 'admin_test_openid_versions';

let adminExists = false;
let adminId = null;

async function trySetupAdmin() {
  const host = process.env.SMOKE_DB_HOST || process.env.DB_HOST;
  try {
    const conn = await mysql.createConnection({
      host, user: process.env.SMOKE_DB_USER || process.env.DB_USER,
      password: process.env.SMOKE_DB_PASS || process.env.DB_PASSWORD,
      database: process.env.SMOKE_DB_NAME || process.env.DB_NAME,
    });
    await conn.query('INSERT IGNORE INTO users (openid) VALUES (?)', [ADMIN_OPENID]);
    await conn.query('INSERT IGNORE INTO admins (openid, note) VALUES (?, ?)', [ADMIN_OPENID, 'smoke']);
    const [rows] = await conn.query('SELECT id FROM users WHERE openid = ?', [ADMIN_OPENID]);
    adminId = rows[0]?.id;
    adminExists = !!adminId;
    await conn.end();
    return adminExists;
  } catch (e) {
    return false;
  }
}

test('GET /api/legal/versions returns current versions', async () => {
  const r = await request(createApp()).get('/api/legal/versions');
  assert.equal(r.status, 200);
  assert.equal(r.body.code, 0);
  assert.ok(r.body.data.privacy, 'data.privacy');
  assert.ok(r.body.data.terms, 'data.terms');
  assert.match(r.body.data.privacy.version, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(r.body.data.terms.version, /^\d{4}-\d{2}-\d{2}$/);
});

test('GET /api/legal/privacy unchanged', async () => {
  const r = await request(createApp()).get('/api/legal/privacy');
  assert.equal(r.status, 200);
  assert.equal(r.body.code, 0);
  assert.match(r.body.data.title, /隐私/);
});

test('admin: forbidden without admin', async () => {
  process.env.JWT_SECRET_OVERRIDE = process.env.JWT_SECRET_OVERRIDE || 'test-secret';
  const jwt = require('../src/services/token');
  const r = await request(createApp())
    .post('/api/admin/legal-version')
    .set('Authorization', 'Bearer ' + jwt.sign({ userId: 999999, openid: 'nopriv' }))
    .send({ doc_type: 'privacy', version: '2026-07-01' });
  assert.equal(r.status, 403, `body=${JSON.stringify(r.body)}`);
});

test('admin: validation errors', async (t) => {
  const ok = await trySetupAdmin();
  if (!ok) {
    t.skip('admin user setup not available in this env');
    return;
  }
  process.env.JWT_SECRET_OVERRIDE = process.env.JWT_SECRET_OVERRIDE || 'test-secret';
  const jwt = require('../src/services/token');
  const app = createApp();

  // bad doc_type
  let r = await request(app)
    .post('/api/admin/legal-version')
    .set('Authorization', 'Bearer ' + jwt.sign({ userId: adminId, openid: ADMIN_OPENID }))
    .send({ doc_type: 'invalid', version: '2026-07-01' });
  assert.equal(r.status, 400);

  // bad version format
  r = await request(app)
    .post('/api/admin/legal-version')
    .set('Authorization', 'Bearer ' + jwt.sign({ userId: adminId, openid: ADMIN_OPENID }))
    .send({ doc_type: 'privacy', version: '2026/07/01' });
  assert.equal(r.status, 400);
});

test('admin: bump version → updates table', async (t) => {
  const ok = await trySetupAdmin();
  if (!ok) {
    t.skip('admin user setup not available in this env');
    return;
  }
  process.env.JWT_SECRET_OVERRIDE = process.env.JWT_SECRET_OVERRIDE || 'test-secret';
  const jwt = require('../src/services/token');
  const app = createApp();

  const r = await request(app)
    .post('/api/admin/legal-version')
    .set('Authorization', 'Bearer ' + jwt.sign({ userId: adminId, openid: ADMIN_OPENID }))
    .send({ doc_type: 'privacy', version: '2026-07-15', note: 'phase 8+ test' });
  assert.equal(r.status, 200, `body=${JSON.stringify(r.body)}`);
  assert.equal(r.body.code, 0);
  assert.equal(r.body.data.version, '2026-07-15');
});
