const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { sign } = require('../src/services/token');
const { userAuth } = require('../src/middleware/auth');
const { errorHandler } = require('../src/middleware/errorHandler');

function makeApp() {
  const app = express();
  app.get('/protected', userAuth, (req, res) => {
    res.json({ code: 0, data: { userId: req.user.userId } });
  });
  app.use(errorHandler);
  return app;
}

test('userAuth allows valid token', async () => {
  const token = sign({ userId: 42, openid: 'o42' });
  const res = await request(makeApp())
    .get('/protected')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.userId, 42);
});

test('userAuth rejects missing token', async () => {
  const res = await request(makeApp()).get('/protected');
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 1002);
});

test('userAuth rejects bad token', async () => {
  const res = await request(makeApp())
    .get('/protected')
    .set('Authorization', 'Bearer garbage');
  assert.equal(res.status, 401);
});
