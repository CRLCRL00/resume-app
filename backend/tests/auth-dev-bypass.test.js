// Dev-bypass login for admin panel (R40 re-attempt of R39-B, which was killed).
// Tests:
//  1) code='dev-bypass' + admin openid → 200 + cookies set
//  2) code='dev-bypass' + non-admin openid → 403
//  3) code='dev-bypass' in production (NODE_ENV=production) → 400 (wechat path is required)
//  4) security event 'security.admin.dev_bypass' is logged on success
//  5) /admin/login.html served at 200 (HTML)
//
// Note: this test file does NOT stub wechatService — the bypass path skips it
// entirely. Existing /api/auth/login route uses wechatService.code2session
// which would fail in a real env without a real WX_APPID, but the dev-bypass
// short-circuit happens before that call.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const request = require('supertest');

const { createApp } = require('../src/app');
const { getPool, cleanup } = require('./helpers/db');
const pool = getPool();

const ADMIN_OPENID = 'dev_bypass_admin_openid';
const NON_ADMIN_OPENID = 'dev_bypass_nonadmin_openid';

function parseCookie(setCookie, name) {
  if (!setCookie) return null;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const line of arr) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const k = pair.slice(0, eq).trim();
    if (k === name) return line.trim();
  }
  return null;
}

test.before(async () => {
  // ensure admin + non-admin openids exist (or not) for test matrix
  await pool.query("DELETE FROM admins WHERE openid = ?", [ADMIN_OPENID]);
  await pool.query("INSERT INTO admins (openid, note) VALUES (?, 'dev-bypass-test')", [ADMIN_OPENID]);
  await pool.query("DELETE FROM users WHERE openid = ?", [NON_ADMIN_OPENID]);
  await pool.query("DELETE FROM admin_operation_logs WHERE admin_openid IN (?, ?)", [ADMIN_OPENID, NON_ADMIN_OPENID]);
});

test('POST /api/auth/login dev-bypass + admin openid → 200 + cookie set', async () => {
  const res = await request(createApp())
    .post('/api/auth/login')
    .send({ code: 'dev-bypass', openid: ADMIN_OPENID });
  assert.equal(res.status, 200, `body=${JSON.stringify(res.body)}`);
  assert.equal(res.body.code, 0);
  assert.ok(res.body.data.token, 'should return token');
  assert.ok(res.body.data.user, 'should return user');
  assert.equal(res.body.data.user.openid, ADMIN_OPENID);
  // cookie side: same as normal /login
  const setCookie = res.headers['set-cookie'];
  assert.ok(setCookie, 'set-cookie header 应存在');
  assert.ok(parseCookie(setCookie, 'auth_token'), 'auth_token cookie 应被 set');
  assert.ok(parseCookie(setCookie, 'refresh_token'), 'refresh_token cookie 应被 set');
});

test('POST /api/auth/login dev-bypass + non-admin openid → 403', async () => {
  const res = await request(createApp())
    .post('/api/auth/login')
    .send({ code: 'dev-bypass', openid: NON_ADMIN_OPENID });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 1003);
});

test('POST /api/auth/login dev-bypass in production → 400 (dev-bypass disabled)', async () => {
  const origEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const res = await request(createApp())
      .post('/api/auth/login')
      .send({ code: 'dev-bypass', openid: ADMIN_OPENID });
    // expected: dev-bypass 走 400 'wechat code required' (等同于 missing code 路径)
    // 因为 NODE_ENV=production 时 dev-bypass 分支被跳过
    assert.equal(res.status, 400, `body=${JSON.stringify(res.body)}`);
    // body 形态取决于 fallback：可能 1000 'code is required'（如果 dev-bypass 完全
    // 不触发 → 走 wechat code2session → 但 NODE_ENV=test 跑测试 wechat 真发会超时失败）
    // 我们至少确认 status 400 而不是 200
  } finally {
    process.env.NODE_ENV = origEnv;
  }
});

test('POST /api/auth/login dev-bypass logs security.admin.dev_bypass event', async () => {
  // 先跑一次 dev-bypass
  const res = await request(createApp())
    .post('/api/auth/login')
    .send({ code: 'dev-bypass', openid: ADMIN_OPENID });
  assert.equal(res.status, 200);
  // securityLog.recordSync 是 fire-and-forget；轮询 1.5s 内能看到
  // securityLog 把 openid 放在 detail JSON 里（不是 admin_openid 列；/login 阶段
  // userAuth 未跑，req.user undefined → admin_openid 走 '__system__' 默认）
  const start = Date.now();
  let found = null;
  while (Date.now() - start < 1500) {
    const [rows] = await pool.query(
      `SELECT id, action, detail, admin_openid
       FROM admin_operation_logs
       WHERE action = 'security.admin.dev_bypass'
       ORDER BY id DESC LIMIT 1`
    );
    if (rows.length) {
      const detail = typeof rows[0].detail === 'string' ? JSON.parse(rows[0].detail) : rows[0].detail;
      if (detail && detail.openid === ADMIN_OPENID) { found = rows[0]; break; }
    }
    await new Promise(r => setTimeout(r, 50));
  }
  assert.ok(found, 'security.admin.dev_bypass 应被记录到 admin_operation_logs');
  const detail = typeof found.detail === 'string' ? JSON.parse(found.detail) : found.detail;
  assert.equal(detail.openid, ADMIN_OPENID);
});

test('GET /admin/login.html → 200 + HTML content', async () => {
  const res = await request(createApp()).get('/admin/login.html');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'] || '', /html/i);
  const body = res.text || '';
  assert.ok(body.includes('<form') || body.includes('form'), 'login.html 应含 form 元素');
  assert.ok(body.includes('dev-bypass') || body.includes('openid'), 'login.html 应含 dev-bypass 或 openid 标识');
});

test.after(async () => {
  await pool.query("DELETE FROM admin_operation_logs WHERE admin_openid = ?", [ADMIN_OPENID]);
  await pool.query("DELETE FROM admins WHERE openid = ?", [ADMIN_OPENID]);
  await cleanup();
});
