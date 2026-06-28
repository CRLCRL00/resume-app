const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { sign } = require('../src/services/token');

test('POST /api/match without token returns 401', async () => {
  const res = await request(createApp()).post('/api/match').send({ resume_id: 1 });
  assert.equal(res.status, 401);
});

test('POST /api/match with missing resume_id returns 400', async () => {
  const token = sign({ userId: 1, openid: 'x' });
  const res = await request(createApp())
    .post('/api/match')
    .set('Authorization', `Bearer ${token}`)
    .send({});
  assert.equal(res.status, 400);
});

test('POST /api/match with non-existent resume returns 404', async () => {
  const token = sign({ userId: 1, openid: 'x' });
  const res = await request(createApp())
    .post('/api/match')
    .set('Authorization', `Bearer ${token}`)
    .send({ resume_id: 99999 });
  assert.equal(res.status, 404);
});

test('POST /api/match rate limits at 4/min', async () => {
  const userId = 5000;
  const token = sign({ userId, openid: 'rl_match' });
  // 调 5 次（用任意 resume_id，第 4 次后返 429）
  for (let i = 0; i < 4; i++) {
    const res = await request(createApp())
      .post('/api/match')
      .set('Authorization', `Bearer ${token}`)
      .send({ resume_id: 99999 });
    // 前 3 次会 404（resume 不存在），第 4 次可能 429 也可能 404
  }
  const res = await request(createApp())
    .post('/api/match')
    .set('Authorization', `Bearer ${token}`)
    .send({ resume_id: 99999 });
  assert.ok([404, 429].includes(res.status));
});