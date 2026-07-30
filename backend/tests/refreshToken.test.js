const { test } = require('node:test');
const assert = require('node:assert/strict');
const t = require('../src/services/token');
const redis = require('../src/config/redis');

test('sign issues jti + no kind field', () => {
  const tok = t.sign({ openid: 'u1' });
  const d = t.decode(tok);
  assert.ok(d.jti, 'should have jti');
  assert.ok(!d.kind, 'access token has no kind');
});

test('signRefresh includes kind=refresh + family', () => {
  const tok = t.signRefresh({ openid: 'u1' }, 'fam-A');
  const d = t.decode(tok);
  assert.strictEqual(d.kind, 'refresh');
  assert.strictEqual(d.family, 'fam-A');
  assert.ok(d.jti);
});

test('revoke makes jti rejected', async () => {
  const tok = t.sign({ openid: 'u1' });
  const jti = t.decode(tok).jti;
  await t.revoke(jti, 60);
  assert.strictEqual(await t.isRevoked(jti), true);
  await redis.del(`jwt:bl:${jti}`);
});

// --- spec: signAccess / verifyAccess 命名 + back-compat ---

test('signAccess returns token with jti', () => {
  const tok = t.signAccess({ openid: 'u1' });
  assert.ok(tok);
  const jti = t.decode(tok).jti;
  assert.ok(jti);
});

test('verifyAccess roundtrips', () => {
  const tok = t.signAccess({ openid: 'u2' });
  const decoded = t.verifyAccess(tok);
  assert.strictEqual(decoded.openid, 'u2');
});

test('signRefresh + revokeRefresh + isRefreshRevoked', async () => {
  const tok = t.signRefresh({ openid: 'u3' }, 'fam-spec-1');
  assert.ok(tok);
  // revoke + isRefreshRevoked 走 redis；test env redis 可用
  const jti = t.decode(tok).jti;
  await t.revokeRefresh(jti, 60);
  assert.strictEqual(await t.isRefreshRevoked(jti), true);
  await redis.del(`jwt:bl:${jti}`);
});

test('back-compat sign/verify still works', () => {
  const tok = t.sign({ openid: 'u4' });
  const d = t.verify(tok);
  assert.strictEqual(d.openid, 'u4');
});

test('refresh route via supertest rotates and revokes', async (t2) => {
  // guard：需要 redis 可用。CI 没 redis 时 skip
  let redisOk = true;
  try { await redis.ping(); } catch (_e) { redisOk = false; }
  if (!redisOk) return t2.skip('redis unavailable');
  const request = require('supertest');
  const { createApp } = require('../src/app');
  const openid = 'rt_test_openid_' + Date.now();
  const family = 'fam-rt-' + Date.now();
  const r = t.signRefresh({ openid }, family);
  const res = await request(createApp())
    .post('/api/auth/refresh')
    .send({ refresh_token: r });
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.data.access_token);
  assert.ok(res.body.data.refresh_token);
  assert.notStrictEqual(res.body.data.refresh_token, r); // rotated
  // cleanup
  const oldJti = t.decode(r).jti;
  await redis.del(`jwt:bl:${oldJti}`);
  await redis.del(`jwt:fam:${family}:${oldJti}`);
  const newJti = t.decode(res.body.data.refresh_token).jti;
  await redis.del(`jwt:bl:${newJti}`);
});
