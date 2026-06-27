const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { sign } = require('../src/services/token');
const pool = require('../src/config/db');

async function insertResume(userId, form) {
  const [r] = await pool.query(
    'INSERT INTO resumes (user_id, source_form, content_md, is_active) VALUES (?, ?, ?, 1)',
    [userId, JSON.stringify(form), '']
  );
  return r.insertId;
}

test('POST /api/resume/generate without token returns 401', async () => {
  const res = await request(createApp()).post('/api/resume/generate').send({ resume_id: 1 });
  assert.equal(res.status, 401);
});

test('POST /api/resume/generate with missing resume_id returns 400', async () => {
  const token = sign({ userId: 1, openid: 'x' });
  const res = await request(createApp())
    .post('/api/resume/generate')
    .set('Authorization', `Bearer ${token}`)
    .send({});
  assert.equal(res.status, 400);
});

test('POST /api/resume/generate with non-existent resume returns 404', async () => {
  const token = sign({ userId: 1, openid: 'x' });
  const res = await request(createApp())
    .post('/api/resume/generate')
    .set('Authorization', `Bearer ${token}`)
    .send({ resume_id: 999999 });
  assert.equal(res.status, 404);
});

test('POST /api/resume/generate with valid resume returns content_md', async () => {
  const token = sign({ userId: 1, openid: 'x' });
  const form = {
    name: '测试', gender: 'male', degree: '本科', phone: '',
    educations: [{ school: 's', major: 'm', degree: 'd', start: '2020-01', end: '至今' }],
    experiences: [{ company: 'c', title: 't', start: '2021-01', end: '至今', desc: 'd' }],
    expected: { city: '深圳', position: '前端', salary_min: 10, salary_max: 20 },
    skills: ['React'],
  };
  const resumeId = await insertResume(1, form);

  const res = await request(createApp())
    .post('/api/resume/generate')
    .set('Authorization', `Bearer ${token}`)
    .send({ resume_id: resumeId });

  assert.equal(res.status, 200);
  assert.match(res.body.data.content_md, /^# 测试/);
  assert.ok(res.body.data.content_md.includes('React'));

  await pool.query('DELETE FROM resumes WHERE id = ?', [resumeId]);
  await pool.end();
});