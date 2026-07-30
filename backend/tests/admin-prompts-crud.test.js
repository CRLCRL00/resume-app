const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { sign } = require('../src/services/token');
const { getPool, cleanup } = require('./helpers/db');
const pool = getPool();

const ADMIN_OPENID = 'admin_phase4_test';

test.before(async () => {
  await pool.query("DELETE FROM admins WHERE openid = ?", [ADMIN_OPENID]);
  await pool.query("INSERT INTO admins (openid, note) VALUES (?, 'phase4-test')", [ADMIN_OPENID]);
  // Seed a prior (inactive) version of test_code_xxx so the PUT can create v2
  await pool.query("DELETE FROM prompts WHERE code = 'test_code_xxx'");
  await pool.query("INSERT INTO prompts (code, name, content, version, is_active) VALUES ('test_code_xxx', 'test_code_xxx', '# v1', 1, 0)");
});

test('GET /api/admin/prompts without token returns 401', async () => {
  const res = await request(createApp()).get('/api/admin/prompts');
  assert.equal(res.status, 401);
});

test('GET /api/admin/prompts with non-admin returns 403', async () => {
  const token = sign({ userId: 1, openid: 'non_admin_xxx' });
  const res = await request(createApp())
    .get('/api/admin/prompts')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 403);
});

test('GET /api/admin/prompts lists prompts', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get('/api/admin/prompts')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data.items));
  assert.ok(res.body.data.items.length >= 2);
});

test('GET /api/admin/prompts/:code returns active content', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get('/api/admin/prompts/resume_generate')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.code, 'resume_generate');
  assert.ok(res.body.data.content.length > 0);
});

test('PUT /api/admin/prompts/:code creates new version', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const newContent = '# test content v99\n# user_form: {user_form}';
  const res = await request(createApp())
    .put('/api/admin/prompts/test_code_xxx')
    .set('Authorization', `Bearer ${token}`)
    .send({ content: newContent });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.version > 1);
  // 验证 active 是新内容
  const [rows] = await pool.query("SELECT content FROM prompts WHERE code = 'test_code_xxx' AND is_active = 1");
  assert.equal(rows[0].content.replace('{user_form}', '').trim(), newContent.replace('{user_form}', '').trim());
});

test('PUT /api/admin/prompts/:code with empty content returns 400', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .put('/api/admin/prompts/test_code_xxx')
    .set('Authorization', `Bearer ${token}`)
    .send({ content: '' });
  assert.equal(res.status, 400);
});

test.after(async () => {
  await pool.query("DELETE FROM prompts WHERE code = 'test_code_xxx'");
  await pool.query("DELETE FROM admins WHERE openid = ?", [ADMIN_OPENID]);
  await pool.query("DELETE FROM admin_operation_logs WHERE admin_openid = ?", [ADMIN_OPENID]);
  await cleanup();
});