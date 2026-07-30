// Round 30-A: full-flow E2E integration test.
// Walks admin → user → resume generate → match generate, plus 2 negative cases.
// Mocks: WeChat code2session + LLM (chat/chatJson). All other layers real.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

// IMPORTANT: mocks must be installed BEFORE app is required.
const { mockWechat, mockLlm, restoreMocks } = require('./helpers/mocks');

const ADMIN_OPENID = 'admin_e2e_test';
const USER_OPENID = 'user_e2e_test';
const JOB_TITLE = 'e2e-job-1';

const RESUME_FORM = {
  name: 'E2E User',
  gender: 'male',
  degree: '本科',
  phone: '13800000000',
  educations: [{
    school: 'Mock University', major: 'CS', degree: '本科',
    start: '2018-09', end: '2022-07',
  }],
  experiences: [{
    company: 'MockCorp', title: 'Engineer',
    start: '2022-08', end: '至今',
    desc: 'Built things end to end.',
  }],
  expected: { city: '深圳', position: 'Backend Engineer', salary_min: 15, salary_max: 30 },
  skills: ['Node.js', 'MySQL'],
};

let app;
let pool;
let redis;
let adminToken;
let adminCsrf;
let userToken;
let jobId;
let resumeId;

// Install mocks first — use a code→openid map so admin + user can log in
// against the SAME app instance (no need to re-create app mid-test, which
// would double-register Prometheus metrics).
mockWechat({ 'mock-code-admin': ADMIN_OPENID, 'mock-code-user': USER_OPENID });
mockLlm();

const { createApp } = require('../../src/app');
const { getPool, getRedis, cleanup } = require('../helpers/db');
pool = getPool();
redis = getRedis();

test.before(async () => {
  // Clean leftover state from prior failed runs
  await pool.query("DELETE FROM admins WHERE openid IN (?, ?)", [ADMIN_OPENID, USER_OPENID]);
  await pool.query("DELETE FROM users WHERE openid IN (?, ?)", [ADMIN_OPENID, USER_OPENID]);
  await pool.query("DELETE FROM jobs WHERE title = ?", [JOB_TITLE]);
  await pool.query("DELETE FROM admin_operation_logs WHERE admin_openid IN (?, ?)", [ADMIN_OPENID, USER_OPENID]);
  await pool.query("DELETE FROM admin_audit WHERE openid IN (?, ?)", [ADMIN_OPENID, USER_OPENID]);

  // Clear any stale rate-limit counters for the IPs we use (defensive)
  try {
    await redis.del('login:ip:10.0.0.1', 'login:ip:10.0.0.2');
  } catch {}

  // Seed admin
  await pool.query("INSERT INTO admins (openid, note) VALUES (?, 'e2e')", [ADMIN_OPENID]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: admin login (mock wx) → 200, returns token + csrfToken
// ─────────────────────────────────────────────────────────────────────────────
test('admin login via mocked wx returns token + csrfToken', async () => {
  app = createApp();
  const res = await request(app)
    .post('/api/auth/login')
    .set('x-forwarded-for', '10.0.0.1')
    .send({ code: 'mock-code-admin' });

  assert.equal(res.status, 200, `login status was ${res.status}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.code, 0);
  assert.ok(res.body.data.token, 'missing access token');
  assert.ok(res.body.data.csrfToken, 'missing csrfToken');
  assert.equal(res.body.data.user.openid, ADMIN_OPENID);

  adminToken = res.body.data.token;
  adminCsrf = res.body.data.csrfToken;
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: user login (mock wx, different openid) → 200
// ─────────────────────────────────────────────────────────────────────────────
test('user login via mocked wx returns token', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .set('x-forwarded-for', '10.0.0.2')
    .send({ code: 'mock-code-user' });

  assert.equal(res.status, 200, `login status was ${res.status}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.code, 0);
  assert.ok(res.body.data.token);
  assert.equal(res.body.data.user.openid, USER_OPENID);

  userToken = res.body.data.token;
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: admin POST /api/admin/jobs with CSRF → 200, returns job_id
// ─────────────────────────────────────────────────────────────────────────────
test('admin POST /api/admin/jobs creates job', async () => {
  const res = await request(app)
    .post('/api/admin/jobs')
    .set('Authorization', `Bearer ${adminToken}`)
    .set('x-csrf-token', adminCsrf)
    .send({
      title: JOB_TITLE,
      company: 'E2E Co',
      city: '深圳',
      salary_min: 15,
      salary_max: 30,
      degree_required: '本科',
      experience_required: '不限',
      skills_required: ['Node.js'],
      description_md: 'E2E test job description.',
    });

  assert.equal(res.status, 200, `admin POST jobs status ${res.status}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.code, 0);
  assert.ok(res.body.data.job_id, 'missing job_id');
  jobId = res.body.data.job_id;

  // Make the job online so public GET /api/jobs/:id finds it
  await pool.query('UPDATE jobs SET is_online = 1, is_deleted = 0 WHERE id = ?', [jobId]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: user GET /api/jobs/:id → 200, returns the e2e job
// (spec said GET /api/jobs; only GET /api/jobs/:id is exposed publicly)
// ─────────────────────────────────────────────────────────────────────────────
test('user GET /api/jobs/:id returns the e2e job', async () => {
  const res = await request(app)
    .get(`/api/jobs/${jobId}`)
    .set('Authorization', `Bearer ${userToken}`);

  assert.equal(res.status, 200, `job detail status ${res.status}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.code, 0);
  assert.equal(res.body.data.id, jobId);
  assert.equal(res.body.data.title, JOB_TITLE);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: user POST /api/resume/save then /api/resume/generate (LLM mocked) → 200
// ─────────────────────────────────────────────────────────────────────────────
test('user POST /api/resume/generate returns content_md via mocked LLM', async () => {
  // Save a resume first so generate has something to operate on
  const saveRes = await request(app)
    .post('/api/resume/save')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ source_form: RESUME_FORM });

  assert.equal(saveRes.status, 200, `resume save status ${saveRes.status}: ${JSON.stringify(saveRes.body)}`);
  assert.ok(saveRes.body.data.resume_id);
  resumeId = saveRes.body.data.resume_id;

  // Generate
  const res = await request(app)
    .post('/api/resume/generate')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ resume_id: resumeId });

  assert.equal(res.status, 200, `resume generate status ${res.status}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.code, 0);
  assert.equal(res.body.data.resume_id, resumeId);
  assert.equal(res.body.data.content_md, '# mock resume\n## mocked section');
  assert.equal(res.body.data.cached, false);

  // Verify DB persisted
  const [rows] = await pool.query('SELECT content_md FROM resumes WHERE id = ?', [resumeId]);
  assert.equal(rows[0].content_md, '# mock resume\n## mocked section');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: user POST /api/match → 200, returns match results
// ─────────────────────────────────────────────────────────────────────────────
test('user POST /api/match returns results via mocked LLM', async () => {
  const res = await request(app)
    .post('/api/match')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ resume_id: resumeId });

  assert.equal(res.status, 200, `match status ${res.status}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.code, 0);
  assert.ok(Array.isArray(res.body.data.results));
  assert.ok(res.body.data.batch_id);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 (negative): user POST /api/admin/jobs → 403
// ─────────────────────────────────────────────────────────────────────────────
test('user cannot POST /api/admin/jobs (403)', async () => {
  const res = await request(app)
    .post('/api/admin/jobs')
    .set('Authorization', `Bearer ${userToken}`)
    .send({
      title: 'should-not-create',
      company: 'x', city: 'y',
      salary_min: 1, salary_max: 2,
      description_md: 'x',
    });

  assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 (negative): admin POST /api/admin/jobs without CSRF → 403
// CSRF middleware is no-op when NODE_ENV=test OR npm_lifecycle_event=test.
// requireCsrf re-reads these per call, so we flip both to bypass the
// "isTest" check without rebuilding the app.
// ─────────────────────────────────────────────────────────────────────────────
test('admin POST /api/admin/jobs without x-csrf-token returns 403', async () => {
  const savedEnv = process.env.NODE_ENV;
  const savedLifecycle = process.env.npm_lifecycle_event;
  process.env.NODE_ENV = 'production';
  process.env.npm_lifecycle_event = '';

  try {
    const res = await request(app)
      .post('/api/admin/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'should-also-not-create',
        company: 'x', city: 'y',
        salary_min: 1, salary_max: 2,
        description_md: 'x',
      });

    assert.equal(res.status, 403, `expected 403 (no csrf), got ${res.status}: ${JSON.stringify(res.body)}`);
  } finally {
    process.env.NODE_ENV = savedEnv;
    process.env.npm_lifecycle_event = savedLifecycle;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup: delete all seeded rows regardless of pass/fail
// ─────────────────────────────────────────────────────────────────────────────
test.after(async () => {
  try {
    // Resolve user_id from USER_OPENID so we can scope deletes
    const [[user]] = await pool.query('SELECT id FROM users WHERE openid = ?', [USER_OPENID]);
    if (user) {
      await pool.query('DELETE FROM matches WHERE user_id = ?', [user.id]);
      await pool.query('DELETE FROM resumes WHERE user_id = ?', [user.id]);
    }
    await pool.query('DELETE FROM jobs WHERE title = ?', [JOB_TITLE]);
    await pool.query('DELETE FROM users WHERE openid IN (?, ?)', [ADMIN_OPENID, USER_OPENID]);
    await pool.query('DELETE FROM admins WHERE openid IN (?, ?)', [ADMIN_OPENID, USER_OPENID]);
    await pool.query('DELETE FROM admin_operation_logs WHERE admin_openid IN (?, ?)', [ADMIN_OPENID, USER_OPENID]);
    await pool.query('DELETE FROM admin_audit WHERE openid IN (?, ?)', [ADMIN_OPENID, USER_OPENID]);
  } catch (err) {
    // best-effort cleanup
    console.error('e2e cleanup error:', err.message);
  } finally {
    restoreMocks();
    await cleanup();
  }
});