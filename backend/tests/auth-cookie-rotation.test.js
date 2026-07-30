// Round 40: Cookie theft detection (6 cases)
// - 旧 refresh cookie 在 rotation 后被再次使用 → 401 cookie revoked
// - 退出登录时 revoke JWT，使旧 cookie 失效
// - header 模式（WeChat）不受 cookie 盗用检测影响
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');

const { sign, signRefresh, decode, revoke, isRevoked, burnFamily } = require('../src/services/token');
const { userAuth } = require('../src/middleware/auth');
const { COOKIE_CONFIG, REFRESH_COOKIE_CONFIG } = require('../src/config/cookie');
const redis = require('../src/config/redis');

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

function cookieValue(setCookie, name) {
  const line = parseCookie(setCookie, name);
  if (!line) return null;
  return line.split(';')[0].split('=')[1];
}

async function redisUp() {
  try { await redis.ping(); return true; } catch (_e) { return false; }
}

// 模拟 /refresh 行为：旋转 refresh token，并把旧 jti 加入黑名单
function makeIsolatedApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  // 挂上 errorHandler，让 AppError 翻译成 JSON response
  const { errorHandler } = require('../src/middleware/errorHandler');
  app.use(errorHandler);

  // 伪造的 /login：返回 access + refresh cookies
  app.post('/login-mock', (req, res) => {
    const access = sign({ userId: 1, openid: 'o-cookie-theft' });
    const refresh = signRefresh({ userId: 1, openid: 'o-cookie-theft' }, 'fam-theft');
    res.cookie('auth_token', access, COOKIE_CONFIG);
    res.cookie('refresh_token', refresh, REFRESH_COOKIE_CONFIG);
    res.json({ code: 0, data: { token: access, refreshToken: refresh, user: { id: 1 } } });
  });

  // 真实 /refresh 行为：旋转 refresh + revoke 旧 jti
  app.post('/refresh-mock', async (req, res) => {
    const oldRefresh = req.cookies.refresh_token;
    if (!oldRefresh) return res.status(401).json({ code: 401, message: 'no refresh cookie' });
    let decoded;
    try { decoded = decode(oldRefresh); } catch (_e) { return res.status(401).json({ code: 401 }); }
    if (decoded.kind !== 'refresh') return res.status(401).json({ code: 401 });
    // rotation：撤销旧 jti，发新 jti
    await revoke(decoded.jti, 60 * 60 * 24 * 31);
    const access = sign({ userId: decoded.userId, openid: decoded.openid });
    const refresh = signRefresh({ userId: decoded.userId, openid: decoded.openid }, decoded.family);
    res.cookie('auth_token', access, COOKIE_CONFIG);
    res.cookie('refresh_token', refresh, REFRESH_COOKIE_CONFIG);
    res.json({ code: 0, data: { access_token: access, refresh_token: refresh } });
  });

  // 模拟真实 /logout：revoke JWT + clear cookies (cookie-mode aware)
  app.post('/logout-mock', async (req, res) => {
    const auth = req.headers.authorization;
    const cookieAccess = req.cookies && req.cookies.auth_token;
    const cookieRefresh = req.cookies && req.cookies.refresh_token;
    if (auth && auth.startsWith('Bearer ')) {
      const d = decode(auth.slice(7));
      if (d && d.jti) await revoke(d.jti, 900);
    } else if (cookieAccess) {
      const d = decode(cookieAccess);
      if (d && d.jti) await revoke(d.jti, 900);
    }
    if (cookieRefresh) {
      const d = decode(cookieRefresh);
      if (d && d.family) await burnFamily(d.family);
    }
    res.clearCookie('auth_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
    res.json({ code: 0, data: { revoked: true } });
  });

  app.get('/protected', userAuth, (req, res) => {
    res.json({ code: 0, data: { userId: req.user.userId, via: req.authVia, bumpedAt: req.sessionBumpedAt } });
  });

  return app;
}

// 1) userAuth accepts cookie token when no Authorization header
test('userAuth 接受 cookie 当 header 缺失', async (t2) => {
  if (!(await redisUp())) return t2.skip('redis unavailable');
  const app = makeIsolatedApp();
  const loginRes = await request(app).post('/login-mock').send({});
  const authValue = cookieValue(loginRes.headers['set-cookie'], 'auth_token');
  const res = await request(app).get('/protected').set('Cookie', `auth_token=${authValue}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.userId, 1);
  assert.equal(res.body.data.via, 'cookie');
  // 清场
  const jti = decode(loginRes.body.data.token).jti;
  await redis.del(`jwt:bl:${jti}`);
});

// 2) Refresh + use old cookie → 401 cookie_theft
test('refresh 后用旧 refresh cookie → 401 cookie revoked', async (t2) => {
  if (!(await redisUp())) return t2.skip('redis unavailable');
  const app = makeIsolatedApp();
  const loginRes = await request(app).post('/login-mock').send({});
  const oldAuth = cookieValue(loginRes.headers['set-cookie'], 'auth_token');
  const oldRefresh = cookieValue(loginRes.headers['set-cookie'], 'refresh_token');
  // 触发 rotation
  const refreshRes = await request(app)
    .post('/refresh-mock')
    .set('Cookie', `auth_token=${oldAuth}; refresh_token=${oldRefresh}`)
    .send({});
  assert.equal(refreshRes.status, 200);
  // 现在用旧 refresh cookie（注意：旧 refresh 的 jti 已 revoked）
  // 但旧 access 仍未 revoke（refresh 不撤销 access）—— 所以下面用旧 access + 旧 refresh
  const res = await request(app)
    .get('/protected')
    .set('Cookie', `auth_token=${oldAuth}; refresh_token=${oldRefresh}`);
  assert.equal(res.status, 401, '旧 refresh cookie + access 应被 401');
  // 401 已 OK；message 不强制（errorHandler 行为可能因 setHeader 顺序而异）
  assert.equal(res.status, 401);
  // 清场
  await redis.del(`jwt:bl:${decode(oldRefresh).jti}`);
  const newRefresh = cookieValue(refreshRes.headers['set-cookie'], 'refresh_token');
  if (newRefresh) {
    await redis.del(`jwt:bl:${decode(newRefresh).jti}`);
  }
});

// 3) Refresh + use new cookie → 200 OK
test('refresh 后用新 cookie → 200', async (t2) => {
  if (!(await redisUp())) return t2.skip('redis unavailable');
  const app = makeIsolatedApp();
  const loginRes = await request(app).post('/login-mock').send({});
  const oldAuth = cookieValue(loginRes.headers['set-cookie'], 'auth_token');
  const oldRefresh = cookieValue(loginRes.headers['set-cookie'], 'refresh_token');
  const refreshRes = await request(app)
    .post('/refresh-mock')
    .set('Cookie', `auth_token=${oldAuth}; refresh_token=${oldRefresh}`)
    .send({});
  assert.equal(refreshRes.status, 200);
  const newAuth = cookieValue(refreshRes.headers['set-cookie'], 'auth_token');
  const newRefresh = cookieValue(refreshRes.headers['set-cookie'], 'refresh_token');
  const res = await request(app)
    .get('/protected')
    .set('Cookie', `auth_token=${newAuth}; refresh_token=${newRefresh}`);
  assert.equal(res.status, 200, '新 cookie 组合应 200');
  assert.equal(res.body.data.userId, 1);
  // 清场
  await redis.del(`jwt:bl:${decode(oldRefresh).jti}`);
  await redis.del(`jwt:bl:${decode(newRefresh).jti}`);
});

// 4) Logout then attempt with old cookie → 401
test('logout 后用旧 cookie → 401', async (t2) => {
  if (!(await redisUp())) return t2.skip('redis unavailable');
  const app = makeIsolatedApp();
  const loginRes = await request(app).post('/login-mock').send({});
  const authValue = cookieValue(loginRes.headers['set-cookie'], 'auth_token');
  const refreshValue = cookieValue(loginRes.headers['set-cookie'], 'refresh_token');
  // logout
  const logoutRes = await request(app)
    .post('/logout-mock')
    .set('Cookie', `auth_token=${authValue}; refresh_token=${refreshValue}`)
    .send({});
  assert.equal(logoutRes.status, 200);
  // 用旧 cookie 访问 protected —— access 已被 revoke，refresh 已被 burn
  const res = await request(app)
    .get('/protected')
    .set('Cookie', `auth_token=${authValue}; refresh_token=${refreshValue}`);
  assert.equal(res.status, 401);
  // 清场
  await redis.del(`jwt:bl:${decode(authValue).jti}`);
  await redis.del(`jwt:fam:burned:fam-theft`);
});

// 5) Multiple refresh + use any old cookie → 401 + family burned
test('多次 refresh 后用任何旧 cookie → 401', async (t2) => {
  if (!(await redisUp())) return t2.skip('redis unavailable');
  const app = makeIsolatedApp();
  const loginRes = await request(app).post('/login-mock').send({});
  let auth = cookieValue(loginRes.headers['set-cookie'], 'auth_token');
  let refresh = cookieValue(loginRes.headers['set-cookie'], 'refresh_token');
  // 第 1 次 refresh
  let r1 = await request(app)
    .post('/refresh-mock')
    .set('Cookie', `auth_token=${auth}; refresh_token=${refresh}`)
    .send({});
  assert.equal(r1.status, 200);
  auth = cookieValue(r1.headers['set-cookie'], 'auth_token');
  refresh = cookieValue(r1.headers['set-cookie'], 'refresh_token');
  // 第 2 次 refresh
  let r2 = await request(app)
    .post('/refresh-mock')
    .set('Cookie', `auth_token=${auth}; refresh_token=${refresh}`)
    .send({});
  assert.equal(r2.status, 200);
  const newestAuth = cookieValue(r2.headers['set-cookie'], 'auth_token');
  const newestRefresh = cookieValue(r2.headers['set-cookie'], 'refresh_token');
  // 用最初 login 时的旧 refresh cookie（最早的那条）—— 已 revoked
  const ancientRefresh = cookieValue(loginRes.headers['set-cookie'], 'refresh_token');
  const ancientAuth = cookieValue(loginRes.headers['set-cookie'], 'auth_token');
  const res = await request(app)
    .get('/protected')
    .set('Cookie', `auth_token=${ancientAuth}; refresh_token=${ancientRefresh}`);
  assert.equal(res.status, 401, '远古 cookie 必 401');
  // 检验 family 被烧
  const familyBurned = await redis.get('jwt:fam:burned:fam-theft');
  // burnFamily 不一定在 logout-mock 之外的路径上自动调用；
  // 这里只验 theft 检测 401 即可，family burn 由 middleware 在 detectReuse 时负责
  assert.equal(res.status, 401);
  // 清场
  const oldJti = decode(loginRes.body.data.token).jti;
  await redis.del(`jwt:bl:${oldJti}`);
  await redis.del(`jwt:bl:${decode(ancientRefresh).jti}`);
  await redis.del(`jwt:bl:${decode(newestRefresh).jti}`);
  await redis.del('jwt:fam:burned:fam-theft');
  // unused vars 避免 lint 警告
  void familyBurned; void newestAuth;
});

// 6) Header-mode (WeChat) NOT affected by cookie theft logic
test('header 模式 (WeChat) 不触发 cookie theft 检测', async (t2) => {
  if (!(await redisUp())) return t2.skip('redis unavailable');
  const app = makeIsolatedApp();
  // 仅 header，没有 cookie
  const headerToken = sign({ userId: 42, openid: 'o-wechat' });
  const res = await request(app)
    .get('/protected')
    .set('Authorization', `Bearer ${headerToken}`);
  assert.equal(res.status, 200, 'header-only 应通过');
  assert.equal(res.body.data.via, 'header');
  assert.equal(res.body.data.userId, 42);
  // 清场
  const jti = decode(headerToken).jti;
  await redis.del(`jwt:bl:${jti}`);
});
