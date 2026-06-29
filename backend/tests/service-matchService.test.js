const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getPool, getRedis, cleanup } = require('./helpers/db');
const { stubChatJson, restoreAll } = require('./helpers/llm');
const pool = getPool();
const redis = getRedis();
const llm = require('../src/services/llm');
const matchService = require('../src/services/matchService');

const TEST_USER = 998;
const TEST_OPENID = 'match_test_user';

test.before(async () => {
  await pool.query("DELETE FROM users WHERE openid = ?", [TEST_OPENID]);
  await pool.query("INSERT INTO users (openid) VALUES (?)", [TEST_OPENID]);
  await pool.query("DELETE FROM matches WHERE user_id = ?", [TEST_USER]);
  await pool.query("DELETE FROM resumes WHERE user_id = ?", [TEST_USER]);
  await pool.query("DELETE FROM jobs WHERE title = 'match_test_job'");
  await redis.del(`match:${TEST_USER}`);
});

test.beforeEach(async () => {
  restoreAll();
  await redis.del(`match:${TEST_USER}`);
});

async function insertResume(contentMd = '') {
  const form = {
    name: 'x', gender: 'male', degree: '高中', phone: '',
    educations: [{ school: 's', major: 'm', degree: 'd', start: '2020-01', end: '至今' }],
    experiences: [{ company: 'c', title: 't', start: '2021-01', end: '至今', desc: 'd' }],
    expected: { city: '深圳', position: 'p', salary_min: 10, salary_max: 25 },
    skills: ['React'],
  };
  const [r] = await pool.query(
    'INSERT INTO resumes (user_id, source_form, content_md, is_active) VALUES (?, ?, ?, 1)',
    [TEST_USER, JSON.stringify(form), contentMd]
  );
  return r.insertId;
}

test('match returns empty when no candidates', async () => {
  // Defensive cleanup: clear any 深圳 jobs (other than the test job) that could match
  await pool.query("DELETE FROM jobs WHERE city = '深圳' AND title <> 'match_test_job'");
  await pool.query("DELETE FROM jobs WHERE title = 'match_test_job'");
  await pool.query("DELETE FROM matches WHERE user_id = ?", [TEST_USER]);
  await redis.del(`match:batch:${TEST_USER}:1`);
  // Defensive stub: even if coarseFilter returns candidates, no real LLM call
  stubChatJson(async () => ({ parsed: { results: [] }, usage: {} }));
  const resumeId = await insertResume('');
  const result = await matchService.match(TEST_USER, resumeId);
  assert.deepEqual(result.results, []);
  assert.match(result.message || '', /未找到/);
  await pool.query('DELETE FROM resumes WHERE id = ?', [resumeId]);
});

test('match calls LLM and stores results', async () => {
  const [r] = await pool.query(
    "INSERT INTO jobs (title, company, city, salary_min, salary_max, description_md, skills_required, is_online, is_deleted) VALUES ('match_test_job', 'TestCo', '深圳', 10, 20, 'desc', '[\"React\"]', 1, 0)"
  );
  const jobId = r.insertId;
  await pool.query("DELETE FROM matches WHERE user_id = ?", [TEST_USER]);
  await redis.del(`match:batch:${TEST_USER}:2`);
  const resumeId = await insertResume('# mock resume');

  stubChatJson(async () => ({
    parsed: { results: [{ job_id: jobId, score: 85, reason: 'good match' }] },
    usage: { total_tokens: 100 },
  }));

  const result = await matchService.match(TEST_USER, resumeId);
  assert.ok(result.results.length >= 1);
  assert.ok(result.batch_id);

  // 验证 matches 表写入
  const [rows] = await pool.query('SELECT * FROM matches WHERE match_batch_id = ?', [result.batch_id]);
  assert.ok(rows.length >= 1);
  assert.equal(rows[0].score, 85);

  await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);
  await pool.query('DELETE FROM resumes WHERE id = ?', [resumeId]);
  await pool.query('DELETE FROM matches WHERE user_id = ?', [TEST_USER]);
});

test('match rejects invalid job_ids from LLM', async () => {
  const [r] = await pool.query(
    "INSERT INTO jobs (title, company, city, salary_min, salary_max, description_md, skills_required, is_online, is_deleted) VALUES ('match_test_job', 'TestCo', '深圳', 10, 20, 'desc', '[]', 1, 0)"
  );
  const jobId = r.insertId;
  await pool.query("DELETE FROM matches WHERE user_id = ?", [TEST_USER]);
  await redis.del(`match:batch:${TEST_USER}:3`);
  const resumeId = await insertResume('# mock resume');

  stubChatJson(async () => ({
    parsed: { results: [
      { job_id: jobId, score: 80, reason: 'valid' },
      { job_id: 99999, score: 90, reason: 'invalid job_id, should be filtered' },
      { job_id: jobId, score: 150, reason: 'score out of range, should be filtered' },
    ]},
    usage: {},
  }));

  const result = await matchService.match(TEST_USER, resumeId);
  // 只保留 1 个有效结果
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].job_id, jobId);

  await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);
  await pool.query('DELETE FROM resumes WHERE id = ?', [resumeId]);
});

test('match returns 404 for non-existent resume', async () => {
  await assert.rejects(matchService.match(TEST_USER, 99999), /resume not found/);
});

test('checkCache returns null when no batch', async () => {
  await redis.del(`match:batch:${TEST_USER}:4`);
  const r = await matchService.checkCache(TEST_USER, 4);
  assert.equal(r, null);
});

test.after(async () => {
  await pool.query("DELETE FROM matches WHERE user_id = ?", [TEST_USER]);
  await pool.query("DELETE FROM resumes WHERE user_id = ?", [TEST_USER]);
  await pool.query("DELETE FROM jobs WHERE title = 'match_test_job'");
  await pool.query("DELETE FROM users WHERE openid = ?", [TEST_OPENID]);
  await cleanup();
});
