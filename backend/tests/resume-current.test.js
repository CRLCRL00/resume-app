const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { sign } = require('../src/services/token');
const pool = require('../src/config/db');

test('GET /api/resume/current without token returns 401', async () => {
  const res = await request(createApp()).get('/api/resume/current');
  assert.equal(res.status, 401);
});

test('GET /api/resume/current with no active resume returns 404', async () => {
  const token = sign({ userId: 1, openid: 'x' });
  await pool.query('DELETE FROM resumes WHERE user_id = 1');

  const res = await request(createApp())
    .get('/api/resume/current')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 404);
});

test('GET /api/resume/current with active resume returns content', async () => {
  const token = sign({ userId: 1, openid: 'x' });
  const form = {
    name: 'Current', gender: 'male', degree: '本科', phone: '',
    educations: [{ school: 's', major: 'm', degree: 'd', start: '2020-01', end: '至今' }],
    experiences: [{ company: 'c', title: 't', start: '2021-01', end: '至今', desc: 'd' }],
    expected: { city: '深圳', position: '前端', salary_min: 10, salary_max: 20 },
    skills: ['React'],
  };
  const [r] = await pool.query(
    'INSERT INTO resumes (user_id, source_form, content_md, is_active) VALUES (?, ?, ?, 1)',
    [1, JSON.stringify(form), '# Current\n\n## 基本信息\n']
  );

  const res = await request(createApp())
    .get('/api/resume/current')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.resume_id, r.insertId);
  assert.match(res.body.data.content_md, /^# Current/);
  assert.equal(res.body.data.source_form.name, 'Current');

  await pool.query('DELETE FROM resumes WHERE id = ?', [r.insertId]);
});

test.after(async () => {
  await pool.end();
  await require('../src/config/redis').quit();
});