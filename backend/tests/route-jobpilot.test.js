/**
 * R-JobSearch 重构: 新路由 HTTP-level 测试
 *
 * 覆盖:
 *   POST   /api/match/apply
 *   GET    /api/match/applications
 *   PATCH  /api/match/applications/:id
 *   GET    /api/resume/story-points/:resumeId
 *
 * 用 supertest + createApp() 模拟 HTTP 请求
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const express = require('express');
const { getPool, cleanup } = require('./helpers/db');
const pool = getPool();
const { mockUserAuth } = require('./helpers/mockAuth');

const TEST_USER_ID = 8002;
const TEST_OPENID = 'route_jobpilot_user';

// 构造带 mock auth 的 mini-app
function buildAppWithMockAuth(routerPath, router) {
  const app = express();
  app.use(express.json());
  app.use(mockUserAuth);  // 注入 mock auth
  app.use(routerPath, router);
  return app;
}

const matchRouter = require('../src/routes/match');
const resumeRouter = require('../src/routes/resume');

test.before(async () => {
  await pool.query("DELETE FROM users WHERE openid = ?", [TEST_OPENID]);
  await pool.query(
    "INSERT INTO users (id, openid) VALUES (?, ?) ON DUPLICATE KEY UPDATE id = ?",
    [TEST_USER_ID, TEST_OPENID, TEST_USER_ID]
  );
  await pool.query('DELETE FROM jobpilot_applications WHERE user_id = ?', [TEST_USER_ID]);
  await pool.query("DELETE FROM jobs WHERE title = 'route_jobpilot_job'");
});

async function makeJob() {
  const [r] = await pool.query(
    `INSERT INTO jobs (title, company, city, salary_min, salary_max, is_online, is_deleted, verify_status)
     VALUES ('route_jobpilot_job', 'TestCo', '深圳', 10, 20, 1, 0, 'verified')`
  );
  return r.insertId;
}

// ==================== POST /api/match/apply ====================

test('POST /api/match/apply creates application', async () => {
  const jobId = await makeJob();
  const app = buildAppWithMockAuth('/api/match', matchRouter);

  const res = await request(app)
    .post('/api/match/apply')
    .send({ job_id: jobId, note: 'test apply' });

  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.equal(res.body.data.status, 'submitted');
  assert.ok(res.body.data.application_id);

  // 验证数据库
  const [rows] = await pool.query(
    'SELECT * FROM jobpilot_applications WHERE id = ?',
    [res.body.data.application_id]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].note, 'test apply');

  // 清理
  await pool.query('DELETE FROM jobpilot_applications WHERE id = ?', [res.body.data.application_id]);
  await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);
});

test('POST /api/match/apply without job_id returns 400', async () => {
  const app = buildAppWithMockAuth('/api/match', matchRouter);
  const res = await request(app)
    .post('/api/match/apply')
    .send({ note: 'no job_id' });

  assert.equal(res.status, 400);
});

test('POST /api/match/apply idempotent (重复返 already_applied)', async () => {
  const jobId = await makeJob();
  const app = buildAppWithMockAuth('/api/match', matchRouter);

  const r1 = await request(app).post('/api/match/apply').send({ job_id: jobId });
  const r2 = await request(app).post('/api/match/apply').send({ job_id: jobId });

  assert.equal(r1.body.data.status, 'submitted');
  assert.equal(r2.body.data.status, 'already_applied');
  assert.equal(r1.body.data.application_id, r2.body.data.application_id);

  await pool.query('DELETE FROM jobpilot_applications WHERE id = ?', [r1.body.data.application_id]);
  await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);
});

// ==================== GET /api/match/applications ====================

test('GET /api/match/applications returns user applications', async () => {
  const jobId = await makeJob();
  const app = buildAppWithMockAuth('/api/match', matchRouter);

  // 先投递一个
  const applyRes = await request(app).post('/api/match/apply').send({ job_id: jobId });

  // 再查询
  const res = await request(app).get('/api/match/applications');
  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.ok(res.body.data.total >= 1);
  assert.ok(res.body.data.applications.length >= 1);

  const found = res.body.data.applications.find(a => a.id === applyRes.body.data.application_id);
  assert.ok(found);
  assert.equal(found.job.title, 'route_jobpilot_job');
  assert.equal(found.job.verify_status, 'verified');

  await pool.query('DELETE FROM jobpilot_applications WHERE id = ?', [applyRes.body.data.application_id]);
  await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);
});

// ==================== PATCH /api/match/applications/:id ====================

test('PATCH /api/match/applications/:id updates status', async () => {
  const jobId = await makeJob();
  const app = buildAppWithMockAuth('/api/match', matchRouter);

  const applyRes = await request(app).post('/api/match/apply').send({ job_id: jobId });
  const applicationId = applyRes.body.data.application_id;

  const res = await request(app)
    .patch(`/api/match/applications/${applicationId}`)
    .send({ status: 'viewed', note: 'HR 已看' });

  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);

  // 验证
  const getRes = await request(app).get('/api/match/applications');
  const updated = getRes.body.data.applications.find(a => a.id === applicationId);
  assert.equal(updated.status, 'viewed');
  assert.equal(updated.note, 'HR 已看');

  await pool.query('DELETE FROM jobpilot_applications WHERE id = ?', [applicationId]);
  await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);
});

test('PATCH /api/match/applications/:id rejects invalid status', async () => {
  const jobId = await makeJob();
  const app = buildAppWithMockAuth('/api/match', matchRouter);

  const applyRes = await request(app).post('/api/match/apply').send({ job_id: jobId });
  const applicationId = applyRes.body.data.application_id;

  const res = await request(app)
    .patch(`/api/match/applications/${applicationId}`)
    .send({ status: 'invalid_status_xyz' });

  assert.equal(res.status, 400);

  await pool.query('DELETE FROM jobpilot_applications WHERE id = ?', [applicationId]);
  await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);
});

test('PATCH /api/match/applications/:id with non-numeric id returns 400', async () => {
  const app = buildAppWithMockAuth('/api/match', matchRouter);
  const res = await request(app)
    .patch('/api/match/applications/abc')
    .send({ status: 'viewed' });

  assert.equal(res.status, 400);
});

// ==================== GET /api/resume/story-points/:resumeId ====================

test('GET /api/resume/story-points/:resumeId returns story points', async () => {
  const storyPoints = [
    { title: '简历生成', situation: '需要 LLM 生成', task: '集成 DeepSeek', action: '用 DeepSeek', result: '114 单测全绿' }
  ];

  // 创建测试 resume
  const [r] = await pool.query(
    `INSERT INTO resumes (user_id, source_form, content_md, story_points, is_active)
     VALUES (?, '{}', 'mock content', ?, 1)`,
    [TEST_USER_ID, JSON.stringify(storyPoints)]
  );
  const resumeId = r.insertId;

  const app = buildAppWithMockAuth('/api/resume', resumeRouter);
  const res = await request(app).get(`/api/resume/story-points/${resumeId}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.equal(res.body.data.resume_id, resumeId);
  assert.equal(res.body.data.story_points.length, 1);
  assert.equal(res.body.data.story_points[0].title, '简历生成');

  await pool.query('DELETE FROM resumes WHERE id = ?', [resumeId]);
});

test('GET /api/resume/story-points/:resumeId with non-numeric returns 400', async () => {
  const app = buildAppWithMockAuth('/api/resume', resumeRouter);
  const res = await request(app).get('/api/resume/story-points/abc');
  assert.equal(res.status, 400);
});

test('GET /api/resume/story-points/:resumeId not found returns 404', async () => {
  const app = buildAppWithMockAuth('/api/resume', resumeRouter);
  const res = await request(app).get('/api/resume/story-points/99999');
  assert.equal(res.status, 404);
});

test.after(async () => {
  await pool.query('DELETE FROM jobpilot_applications WHERE user_id = ?', [TEST_USER_ID]);
  await pool.query("DELETE FROM jobs WHERE title = 'route_jobpilot_job'");
  await pool.query("DELETE FROM users WHERE openid = ?", [TEST_OPENID]);
  await cleanup();
});