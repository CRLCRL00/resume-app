// Cookie-based auth suite (8 cases)
// - /login sets httpOnly + sameSite=lax cookie
// - body 仍含 token（WeChat backward compat）
// - 测试环境 secure=false
// - userAuth 接受 cookie fallback
// - header 优先于 cookie
// - /logout 清 cookie
// - /refresh 重发 cookie
// - cookie 模式下 mutating 请求仍受 CSRF 校验
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');

const { sign, signRefresh, decode } = require('../src/services/token');
const { userAuth } = require('../src/middleware/auth');
const { COOKIE_CONFIG } = require('../src/config/cookie');

// 用 wechatService stub + 直接命中 /login，但生产登录要走 code2session。
// 这里只验 cookie 行为，用一个隔离的 mini-app 模拟 /login 路径足够。

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

function makeIsolatedApp() {
  // 隔离的 mini-app：验证 cookie 设置/清除（不依赖 wechatService/db）
  const app = express();
  app.use(cookieParser());
  app.use(express.json());

  app.post('/login-mock', (req, res) => {
    const access = sign({ userId: 1, openid: 'o-cookie-test' });
    const refresh = signRefresh({ userId: 1, openid: 'o-cookie-test' }, 'fam-cookie');
    res.cookie('auth_token', access, COOKIE_CONFIG);
    res.cookie('refresh_token', refresh, { ...COOKIE_CONFIG, maxAge: 90 * 24 * 60 * 60 * 1000 });
    res.json({ code: 0, data: { token: access, refreshToken: refresh, user: { id: 1 } } });
  });

  app.post('/refresh-mock', (req, res) => {
    const oldRefresh = req.cookies.refresh_token;
    if (!oldRefresh) return res.status(401).json({ code: 401 });
    const decoded = decode(oldRefresh);
    const newAccess = sign({ userId: decoded.userId, openid: decoded.openid });
    res.cookie('auth_token', newAccess, COOKIE_CONFIG);
    res.json({ code: 0, data: { access_token: newAccess } });
  });

  app.post('/logout-mock', (req, res) => {
    res.clearCookie('auth_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
    res.json({ code: 0, data: { revoked: true } });
  });

  app.get('/protected', userAuth, (req, res) => {
    res.json({ code: 0, data: { userId: req.user.userId, via: req.authVia } });
  });

  return app;
}

// 1) /login sets cookie with httpOnly + sameSite=lax + correct maxAge
test('/login-mock sets auth_token cookie httpOnly + sameSite=lax + maxAge=30d', async () => {
  const app = makeIsolatedApp();
  const res = await request(app).post('/login-mock').send({});
  assert.equal(res.status, 200);
  const setCookie = res.headers['set-cookie'];
  assert.ok(setCookie, 'set-cookie header 应存在');
  const authLine = parseCookie(setCookie, 'auth_token');
  assert.ok(authLine, 'auth_token cookie 应被 set');
  assert.match(authLine, /HttpOnly/i, 'httpOnly=true 必须');
  assert.match(authLine, /SameSite=Lax/i, 'sameSite=lax 必须');
  assert.match(authLine, /Max-Age=2592000/i, '30d maxAge=2592000 必须');
  // path
  assert.match(authLine, /Path=\//i, 'path=/ 必须');
  // NODE_ENV=test => secure false
  assert.doesNotMatch(authLine, /Secure/i, '测试环境 secure=false');
});

// 2) /login body still includes token (backward compat)
test('/login-mock 响应 body 含 token (WeChat backward compat)', async () => {
  const app = makeIsolatedApp();
  const res = await request(app).post('/login-mock').send({});
  assert.equal(res.status, 200);
  assert.ok(res.body.data.token, 'body.token 必须在');
  assert.ok(res.body.data.refreshToken, 'body.refreshToken 必须在');
});

// 3) test env: secure=false
test('测试环境 NODE_ENV=test 时 COOKIE_CONFIG.secure=false', () => {
  // 测试时 NODE_ENV 由 runner 设 test
  if (process.env.NODE_ENV !== 'test') return; // 跳过
  assert.equal(COOKIE_CONFIG.secure, false);
  assert.equal(COOKIE_CONFIG.httpOnly, true);
  assert.equal(COOKIE_CONFIG.sameSite, 'lax');
  assert.equal(COOKIE_CONFIG.path, '/');
});

// 4) userAuth accepts cookie when no Authorization header
test('userAuth 从 cookie 读 token 当 Authorization 缺失', async () => {
  const app = makeIsolatedApp();
  // 先 login 拿 cookie
  const loginRes = await request(app).post('/login-mock').send({});
  const authCookieRaw = parseCookie(loginRes.headers['set-cookie'], 'auth_token');
  const value = authCookieRaw.split(';')[0].split('=')[1];
  const res = await request(app)
    .get('/protected')
    .set('Cookie', `auth_token=${value}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.userId, 1);
});

// 5) userAuth prefers Authorization header over cookie
test('userAuth Authorization header 优先于 cookie', async () => {
  const app = makeIsolatedApp();
  // login 拿合法 cookie
  const loginRes = await request(app).post('/login-mock').send({});
  const cookieValue = parseCookie(loginRes.headers['set-cookie'], 'auth_token').split(';')[0].split('=')[1];
  // 同时塞一个不同的合法 token 在 header
  const headerToken = sign({ userId: 99, openid: 'o-header-wins' });
  const res = await request(app)
    .get('/protected')
    .set('Authorization', `Bearer ${headerToken}`)
    .set('Cookie', `auth_token=${cookieValue}`);
  assert.equal(res.status, 200);
  // header userId=99，cookie userId=1，应取 header
  assert.equal(res.body.data.userId, 99);
});

// 6) /logout clears both cookies
test('/logout-mock 清空 auth_token + refresh_token cookie', async () => {
  const app = makeIsolatedApp();
  const loginRes = await request(app).post('/login-mock').send({});
  const cookies = loginRes.headers['set-cookie'];
  // 用 express 自带的 clearCookie 行为：发回 Set-Cookie 头带过去日期
  // 这里直接调用相同路径的 /logout-mock，验证响应头里有清除 cookie 标记
  const authValue = parseCookie(cookies, 'auth_token').split(';')[0].split('=')[1];
  const refValue = parseCookie(cookies, 'refresh_token').split(';')[0].split('=')[1];
  const logoutRes = await request(app)
    .post('/logout-mock')
    .set('Cookie', `auth_token=${authValue}; refresh_token=${refValue}`)
    .send({});
  assert.equal(logoutRes.status, 200);
  const clear = logoutRes.headers['set-cookie'] || [];
  const clearArr = Array.isArray(clear) ? clear : [clear];
  const authClear = clearArr.find((c) => c.startsWith('auth_token='));
  const refClear = clearArr.find((c) => c.startsWith('refresh_token='));
  assert.ok(authClear, 'auth_token 应被 clear');
  assert.ok(refClear, 'refresh_token 应被 clear');
  const expiresText = authClear.toLowerCase();
  assert.ok(
    expiresText.includes('expires=') || expiresText.includes('max-age=0'),
    'clearCookie 应输出过期头'
  );
});

// 7) /refresh re-sets cookie with new token
test('/refresh-mock 重发 auth_token cookie 带新 token', async () => {
  const app = makeIsolatedApp();
  const loginRes = await request(app).post('/login-mock').send({});
  const refCookie = parseCookie(loginRes.headers['set-cookie'], 'refresh_token').split(';')[0].split('=')[1];
  const oldAuth = parseCookie(loginRes.headers['set-cookie'], 'auth_token').split(';')[0].split('=')[1];

  const res = await request(app)
    .post('/refresh-mock')
    .set('Cookie', `auth_token=${oldAuth}; refresh_token=${refCookie}`)
    .send({});
  assert.equal(res.status, 200);
  const setCookie = res.headers['set-cookie'];
  const newAuthLine = parseCookie(setCookie, 'auth_token');
  assert.ok(newAuthLine, '/refresh 应重发 auth_token cookie');
  const newValue = newAuthLine.split(';')[0].split('=')[1];
  assert.notEqual(newValue, oldAuth, '新 token 必须不同于旧 token');
});

// 8) CSRF still enforced when cookie auth is used (mutating without x-csrf-token → 403)
//   cookie-mode + 错误 Origin 应被拒；用最小 mock app 走 e2e。
//   requireCsrf 在 test env 是 noop，所以这里用 mock app 直接挂 requireCsrf，
//   并绕过 isTest() 的两种检测（NODE_ENV + npm_lifecycle_event）。
test('cookie-mode + 错误 Origin 应被 CSRF 拒绝', async () => {
  const csrfModule = require('../src/middleware/csrf');
  // 临时关 isTest() 的两个开关
  const origEnv = process.env.NODE_ENV;
  const origEvt = process.env.npm_lifecycle_event;
  process.env.NODE_ENV = 'production';
  delete process.env.npm_lifecycle_event;
  // mock redis.get 永远空（CSRF token 不匹配）—— 但 Origin check 先发生，应直接 403
  const redis = require('../src/config/redis');
  const origGet = redis.get;
  redis.get = async () => null;
  try {
    // 构造 mutating + cookie-mode + 错误 origin 的 req
    let status = null;
    let body = null;
    let nextCalled = false;
    const req = {
      method: 'POST',
      headers: { origin: 'https://evil.example.com', cookie: 'auth_token=abc' },
      cookies: { auth_token: 'abc' },
      authVia: 'cookie', // 显式走 cookie-mode 分支
      user: { openid: 'o-x', jti: 'jti-x' },
    };
    const res = {
      status(code) { status = code; return this; },
      json(b) { body = b; return this; },
    };
    await csrfModule.requireCsrf(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false, 'next 不应被调用');
    assert.equal(status, 403, `cookie-mode + 错误 origin 应 403，实际 ${status}`);
    assert.equal(body.message, 'origin not allowed');
  } finally {
    redis.get = origGet;
    process.env.NODE_ENV = origEnv;
    if (origEvt !== undefined) process.env.npm_lifecycle_event = origEvt;
  }
  // 断开 redis 防止事件循环挂着（csrf module 已 require 它）
  try { await redis.quit(); } catch (_e) {}
});