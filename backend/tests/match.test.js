const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { sign } = require('../src/services/token');
const { getPool, getRedis, cleanup } = require('./helpers/db');
const { stubChatJson, restoreAll } = require('./helpers/llm');
const pool = getPool();
const redis = getRedis();

const TEST_USER = 7777;
const TEST_OPENID = 'match_route_test_user';
const TITLE = 'match_route_test_job';

test.before(async () => {
  await pool.query("DELETE FROM users WHERE openid = ?", [TEST_OPENID]);
  await pool.query("INSERT INTO users (openid) VALUES (?)", [TEST_OPENID]);
  await pool.query("DELETE FROM matches WHERE user_id = ?", [TEST_USER]);
  await pool.query("DELETE FROM resumes WHERE user_id = ?", [TEST_USER]);
  await pool.query("DELETE FROM jobs WHERE title = ?", [TITLE]);
  await redis.del(`match:${TEST_USER}`);
});

test.beforeEach(() => restoreAll());

async function insertResume() {
  const form = {
    name: 'x', gender: 'male', degree: '高中', phone: '',
    educations: [{ school: 's', major: 'm', degree: 'd', start: '2020-01', end: '至今' }],
    experiences: [{ company: 'c', title: 't', start: '2021-01', end: '至今', desc: 'd' }],
    expected: { city: '深圳', position: 'p', salary_min: 10, salary_max: 25 },
    skills: ['React'],
  };
  const [r] = await pool.query(
    'INSERT INTO resumes (user_id, source_form, content_md, is_active) VALUES (?, ?, ?, 1)',
    [TEST_USER, JSON.stringify(form), '# mock']
  );
  return r.insertId;
}

test('POST /api/match without token returns 401', async () => {
  const res = await request(createApp()).post('/api/match').send({ resume_id: 1 });
  assert.equal(res.status, 401);
});

test('POST /api/match with missing resume_id returns 400', async () => {
  const token = sign({ userId: TEST_USER, openid: TEST_OPENID });
  const res = await request(createApp())
    .post('/api/match')
    .set('Authorization', `Bearer ${token}`)
    .send({});
  assert.equal(res.status, 400);
});

test('POST /api/match with non-existent resume returns 404', async () => {
  const token = sign({ userId: TEST_USER, openid: TEST_OPENID });
  const res = await request(createApp())
    .post('/api/match')
    .set('Authorization', `Bearer ${token}`)
    .send({ resume_id: 9999999 });
  assert.equal(res.status, 404);
});

test('POST /api/match happy path returns results + batch_id (LLM mocked)', async () => {
  await pool.query("DELETE FROM jobs WHERE city = '深圳' AND title <> ?", [TITLE]);
  const [r] = await pool.query(
    "INSERT INTO jobs (title, company, city, salary_min, salary_max, description_md, skills_required, is_online, is_deleted) VALUES (?, 'TestCo', '深圳', 10, 20, 'desc', '[\"React\"]', 1, 0)",
    [TITLE]
  );
  const jobId = r.insertId;
  const resumeId = await insertResume();
  await pool.query("DELETE FROM matches WHERE user_id = ?", [TEST_USER]);
  await redis.del(`match:batch:${TEST_USER}:${resumeId}`);

  stubChatJson(async () => ({
    parsed: { results: [{ job_id: jobId, score: 88, reason: 'good' }] },
    usage: {},
  }));

  const token = sign({ userId: TEST_USER, openid: TEST_OPENID });
  const res = await request(createApp())
    .post('/api/match')
    .set('Authorization', `Bearer ${token}`)
    .send({ resume_id: resumeId });

  assert.equal(res.status, 200);
  assert.ok(res.body.data.batch_id);
  assert.ok(Array.isArray(res.body.data.results));
  assert.ok(res.body.data.results.length >= 1);
  assert.equal(res.body.data.results[0].job_id, jobId);
  assert.ok(typeof res.body.data.results[0].score === 'number');
  assert.ok(typeof res.body.data.results[0].reason === 'string');

  await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);
  await pool.query('DELETE FROM resumes WHERE id = ?', [resumeId]);
  await pool.query('DELETE FROM matches WHERE user_id = ?', [TEST_USER]);
});

test('POST /api/match clamps/filters out-of-range LLM scores', async () => {
  const [r] = await pool.query(
    "INSERT INTO jobs (title, company, city, salary_min, salary_max, description_md, skills_required, is_online, is_deleted) VALUES (?, 'TestCo', '深圳', 10, 20, 'desc', '[\"React\"]', 1, 0)",
    [TITLE]
  );
  const jobId = r.insertId;
  const resumeId = await insertResume();
  await pool.query("DELETE FROM matches WHERE user_id = ?", [TEST_USER]);
  await redis.del(`match:batch:${TEST_USER}:${resumeId}`);

  stubChatJson(async () => ({
    parsed: { results: [
      { job_id: jobId, score: 75, reason: 'ok' },
      { job_id: jobId, score: 150, reason: 'too high' },
      { job_id: jobId, score: -10, reason: 'too low' },
    ]},
    usage: {},
  }));

  const token = sign({ userId: TEST_USER, openid: TEST_OPENID });
  const res = await request(createApp())
    .post('/api/match')
    .set('Authorization', `Bearer ${token}`)
    .send({ resume_id: resumeId });

  assert.equal(res.status, 200);
  // 仅 75 保留；150/-10 被过滤（range check 0..100）
  assert.equal(res.body.data.results.length, 1);
  assert.equal(res.body.data.results[0].score, 75);

  await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);
  await pool.query('DELETE FROM resumes WHERE id = ?', [resumeId]);
  await pool.query('DELETE FROM matches WHERE user_id = ?', [TEST_USER]);
});

test('POST /api/match rejects invalid job_id from LLM', async () => {
  const resumeId = await insertResume();
  await pool.query("DELETE FROM matches WHERE user_id = ?", [TEST_USER]);
  await redis.del(`match:batch:${TEST_USER}:${resumeId}`);

  stubChatJson(async () => ({
    parsed: { results: [
      { job_id: 9999999, score: 99, reason: 'invalid id' },
    ]},
    usage: {},
  }));

  const token = sign({ userId: TEST_USER, openid: TEST_OPENID });
  const res = await request(createApp())
    .post('/api/match')
    .set('Authorization', `Bearer ${token}`)
    .send({ resume_id: resumeId });

  // 没匹配 → 仍 200，results 为空 + message
  assert.equal(res.status, 200);
  assert.equal(res.body.data.results.length, 0);

  await pool.query('DELETE FROM resumes WHERE id = ?', [resumeId]);
});

test('POST /api/match rate-limits at 4/min', async () => {
  // 用唯一 userId 避免跨运行/跨测试污染 redis 计数器
  const u = 80000 + Math.floor(Math.random() * 10000);
  const o = `match_rl_${u}`;
  await pool.query("DELETE FROM users WHERE openid = ?", [o]);
  await pool.query("INSERT INTO users (openid) VALUES (?)", [o]);
  await pool.query("DELETE FROM resumes WHERE user_id = ?", [u]);
  await pool.query("DELETE FROM matches WHERE user_id = ?", [u]);
  await redis.del(`match:${u}`);
  // rateLimit 在 service 内（resume 之后），需真实 resume 才能触发
  const form = { name: 'x', gender: 'male', degree: '不限', phone: '',
    educations: [], experiences: [], expected: {}, skills: [] };
  const [r] = await pool.query(
    'INSERT INTO resumes (user_id, source_form, content_md, is_active) VALUES (?, ?, ?, 1)',
    [u, JSON.stringify(form), '# rl']
  );
  const resumeId = r.insertId;

  // 全部 stub 出空 → service 走到 rateLimit.check 然后返 200（空 results），不停 429
  // 但连续 6 次调用会让计数到 6，超过 4 触发
  stubChatJson(async () => ({ parsed: { results: [] }, usage: {} }));

  const token = sign({ userId: u, openid: o });
  let saw429 = false;
  for (let i = 0; i < 6; i++) {
    const res = await request(createApp())
      .post('/api/match')
      .set('Authorization', `Bearer ${token}`)
      .send({ resume_id: resumeId });
    if (res.status === 429) { saw429 = true; break; }
  }
  assert.equal(saw429, true, 'should hit 429 within 6 requests');
  await redis.del(`match:${u}`);
  await pool.query("DELETE FROM matches WHERE user_id = ?", [u]);
  await pool.query("DELETE FROM resumes WHERE id = ?", [resumeId]);
  await pool.query("DELETE FROM users WHERE openid = ?", [o]);
});

test.after(async () => {
  await pool.query("DELETE FROM matches WHERE user_id = ?", [TEST_USER]);
  await pool.query("DELETE FROM resumes WHERE user_id = ?", [TEST_USER]);
  await pool.query("DELETE FROM jobs WHERE title = ?", [TITLE]);
  await pool.query("DELETE FROM users WHERE openid = ?", [TEST_OPENID]);
  await cleanup();
});
