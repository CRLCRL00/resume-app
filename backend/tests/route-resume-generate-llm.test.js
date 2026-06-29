const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { sign } = require('../src/services/token');
const { getPool, getRedis, cleanup } = require('./helpers/db');
const pool = getPool();
const redis = getRedis();
const { chat } = require('../src/services/llm');

const validForm = {
  name: 'Test', gender: 'male', degree: '本科', phone: '',
  educations: [{ school: 's', major: 'm', degree: 'd', start: '2020-01', end: '至今' }],
  experiences: [{ company: 'c', title: 't', start: '2021-01', end: '至今', desc: 'd' }],
  expected: { city: 'x', position: 'y', salary_min: 10, salary_max: 20 },
  skills: ['React'],
};

async function insertResume(userId, contentMd = '') {
  const [r] = await pool.query(
    'INSERT INTO resumes (user_id, source_form, content_md, is_active) VALUES (?, ?, ?, 1)',
    [userId, JSON.stringify(validForm), contentMd]
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

test('POST /api/resume/generate hits DB cache when content_md exists', async () => {
  const token = sign({ userId: 1, openid: 'x' });
  await pool.query('DELETE FROM resumes WHERE user_id = 1');
  const id = await insertResume(1, '# 缓存内容');

  let llmCalled = false;
  const orig = chat;
  require('../src/services/llm').chat = async () => {
    llmCalled = true;
    return { content: 'NEW', usage: {} };
  };

  const res = await request(createApp())
    .post('/api/resume/generate')
    .set('Authorization', `Bearer ${token}`)
    .send({ resume_id: id });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.content_md, '# 缓存内容');
  assert.equal(res.body.data.cached, true);
  assert.equal(llmCalled, false, 'LLM should NOT be called when cache hit');

  require('../src/services/llm').chat = orig;
  await pool.query('DELETE FROM resumes WHERE id = ?', [id]);
});

test('POST /api/resume/generate calls LLM when no cache and stores result', async () => {
  const token = sign({ userId: 1, openid: 'x' });
  await pool.query('DELETE FROM resumes WHERE user_id = 1');
  const id = await insertResume(1, '');

  const orig = chat;
  require('../src/services/llm').chat = async () => ({
    content: '# LLM 生成\n## 内容', usage: { total_tokens: 100 },
  });

  const res = await request(createApp())
    .post('/api/resume/generate')
    .set('Authorization', `Bearer ${token}`)
    .send({ resume_id: id });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.content_md, '# LLM 生成\n## 内容');
  assert.equal(res.body.data.cached, false);

  // 验证 DB 写入了
  const [rows] = await pool.query('SELECT content_md FROM resumes WHERE id = ?', [id]);
  assert.equal(rows[0].content_md, '# LLM 生成\n## 内容');

  require('../src/services/llm').chat = orig;
  await pool.query('DELETE FROM resumes WHERE id = ?', [id]);
});

test('POST /api/resume/generate returns 502 on LLM failure', async () => {
  const token = sign({ userId: 1, openid: 'x' });
  await pool.query('DELETE FROM resumes WHERE user_id = 1');
  const id = await insertResume(1, '');

  const orig = chat;
  require('../src/services/llm').chat = async () => {
    const { AppError } = require('../src/middleware/errorHandler');
    throw new AppError(1100, 'llm api error', 502);
  };

  const res = await request(createApp())
    .post('/api/resume/generate')
    .set('Authorization', `Bearer ${token}`)
    .send({ resume_id: id });

  assert.equal(res.status, 502);
  assert.match(res.body.message, /llm/);

  require('../src/services/llm').chat = orig;
  await pool.query('DELETE FROM resumes WHERE id = ?', [id]);
});

test('POST /api/resume/generate rate limits at 4/min', async () => {
  const userId = 999;
  const token = sign({ userId, openid: 'rl' });
  await pool.query('DELETE FROM resumes WHERE user_id = ?', [userId]);
  await redis.del(`generate:${userId}`);

  // 插 4 个 resume 用来调 4 次
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(await insertResume(userId, ''));

  const orig = chat;
  require('../src/services/llm').chat = async () => ({ content: 'ok', usage: {} });

  for (let i = 0; i < 4; i++) {
    const res = await request(createApp())
      .post('/api/resume/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ resume_id: ids[i] });
    assert.notEqual(res.status, 429, `call ${i+1} should not be limited`);
  }

  // 第 5 次（用第 1 个 resume 的 cached 内容，但限流先返）
  const res = await request(createApp())
    .post('/api/resume/generate')
    .set('Authorization', `Bearer ${token}`)
    .send({ resume_id: ids[0] });
  assert.equal(res.status, 429);

  require('../src/services/llm').chat = orig;
  await pool.query('DELETE FROM resumes WHERE user_id = ?', [userId]);
  await redis.del(`generate:${userId}`);
});

test.after(async () => {
  await pool.query('DELETE FROM resumes WHERE user_id IN (1, 999)');
  await cleanup();
});
