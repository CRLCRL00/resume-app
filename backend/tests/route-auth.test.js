const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { code2session } = require('../src/services/wechat');
const { getPool, cleanup } = require('./helpers/db');
const pool = getPool();

const origCode2session = code2session;

test('POST /api/auth/login with valid code returns token + user', async () => {
  const openid = 'test_openid_' + Date.now();
  require('../src/services/wechat').code2session = async (code) => ({
    openid,
    session_key: 'sk',
  });

  await pool.query('DELETE FROM users WHERE openid = ?', [openid]);

  const res = await request(createApp())
    .post('/api/auth/login')
    .send({ code: 'mock_code' });

  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.ok(res.body.data.token, 'should return token');
  assert.ok(res.body.data.user.id, 'should return user with id');
  assert.equal(res.body.data.user.openid, openid);

  await pool.query('DELETE FROM users WHERE openid = ?', [openid]);
});

test('POST /api/auth/login with missing code returns 400', async () => {
  const res = await request(createApp())
    .post('/api/auth/login')
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 1000);
});

test('POST /api/auth/login with wechat error returns 400', async () => {
  require('../src/services/wechat').code2session = async () => {
    const { AppError } = require('../src/middleware/errorHandler');
    throw new AppError(1001, 'invalid code', 400);
  };

  const res = await request(createApp())
    .post('/api/auth/login')
    .send({ code: 'bad' });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 1001);
});

test.after(async () => {
  require('../src/services/wechat').code2session = origCode2session;
  await cleanup();
});
