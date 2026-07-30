const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/config/db');

const validForm = {
  source_form: {
    name: '测试', gender: 'male', degree: '本科', phone: '',
    educations: [{ school: 's', major: 'm', degree: 'd', start: '2020-01', end: '至今' }],
    experiences: [{ company: 'c', title: 't', start: '2021-01', end: '至今', desc: 'd' }],
    expected: { city: '深圳', position: '前端', salary_min: 10, salary_max: 20 },
    skills: ['React'],
  },
};

test('POST /api/resume/save without token returns 401', async () => {
  const res = await request(createApp()).post('/api/resume/save').send(validForm);
  assert.equal(res.status, 401);
});

test('POST /api/resume/save with invalid body returns 400', async () => {
  // 用现有 userAuth 跑（mock token 走不通，so 测试 mock 全局 verify）
  const token = require('../src/services/token').sign({ userId: 1, openid: 'x' });
  const res = await request(createApp())
    .post('/api/resume/save')
    .set('Authorization', `Bearer ${token}`)
    .send({ source_form: { name: '' } }); // 缺字段
  assert.equal(res.status, 400);
  assert.match(res.body.message, /name/);
});

test('POST /api/resume/save with salary_max < salary_min returns 400', async () => {
  const token = require('../src/services/token').sign({ userId: 1, openid: 'x' });
  const res = await request(createApp())
    .post('/api/resume/save')
    .set('Authorization', `Bearer ${token}`)
    .send({
      source_form: {
        ...validForm.source_form,
        expected: { city: 'x', position: 'y', salary_min: 25, salary_max: 15 },
      },
    });
  assert.equal(res.status, 400);
});

test('POST /api/resume/save with valid form inserts row', async () => {
  const token = require('../src/services/token').sign({ userId: 1, openid: 'x' });
  await pool.query("DELETE FROM resumes WHERE user_id = 1");

  const res = await request(createApp())
    .post('/api/resume/save')
    .set('Authorization', `Bearer ${token}`)
    .send(validForm);

  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.ok(res.body.data.resume_id);
  assert.ok(res.body.data.created_at);

  await pool.query("DELETE FROM resumes WHERE user_id = 1");
});

test.after(async () => {
  await pool.end();
  await require('../src/config/redis').quit();
});