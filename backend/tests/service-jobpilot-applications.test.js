/**
 * R-JobSearch 重构: jobpilot_applications 表 + applyToJob/getApplications/updateApplicationStatus 测试
 *
 * 覆盖洞察 #5: 投递追踪 > 一次性
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getPool, getRedis } = require('./helpers/db');
const pool = getPool();
const redis = getRedis();
const matchService = require('../src/services/matchService');

const TEST_USER = 8001;
const TEST_OPENID = 'jobpilot_test_user';

test.before(async () => {
  // 准备测试数据
  await pool.query("DELETE FROM users WHERE openid = ?", [TEST_OPENID]);
  await pool.query("INSERT INTO users (id, openid) VALUES (?, ?)", [TEST_USER, TEST_OPENID]);
  await pool.query("DELETE FROM jobpilot_applications WHERE user_id = ?", [TEST_USER]);
  await pool.query("DELETE FROM jobs WHERE title = 'jobpilot_test_job'");
});

test('applyToJob creates new application', async () => {
  // 1. 创建测试 job
  const [jr] = await pool.query(
    `INSERT INTO jobs (title, company, city, salary_min, salary_max, description_md, skills_required, is_online, is_deleted, verify_status)
     VALUES ('jobpilot_test_job', 'TestCo', '深圳', 10, 20, 'desc', '["React"]', 1, 0, 'verified')`
  );
  const jobId = jr.insertId;

  // 2. 调用 applyToJob
  const result = await matchService.applyToJob(TEST_USER, jobId, { note: 'first apply' });
  assert.equal(result.status, 'submitted');
  assert.ok(result.application_id);

  // 3. 验证数据库
  const [rows] = await pool.query(
    'SELECT * FROM jobpilot_applications WHERE id = ?',
    [result.application_id]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, TEST_USER);
  assert.equal(rows[0].job_id, jobId);
  assert.equal(rows[0].status, 'submitted');
  assert.equal(rows[0].note, 'first apply');
  assert.ok(rows[0].follow_up_at);  // 默认 3 天后

  // 清理
  await pool.query('DELETE FROM jobpilot_applications WHERE id = ?', [result.application_id]);
  await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);
});

test('applyToJob is idempotent (重复投递返回 already_applied)', async () => {
  const [jr] = await pool.query(
    `INSERT INTO jobs (title, company, city, salary_min, salary_max, is_online, is_deleted, verify_status)
     VALUES ('jobpilot_test_job', 'TestCo', '深圳', 10, 20, 1, 0, 'verified')`
  );
  const jobId = jr.insertId;

  const r1 = await matchService.applyToJob(TEST_USER, jobId);
  const r2 = await matchService.applyToJob(TEST_USER, jobId);

  assert.equal(r1.status, 'submitted');
  assert.equal(r2.status, 'already_applied');
  assert.equal(r1.application_id, r2.application_id);  // 同一个 application

  await pool.query('DELETE FROM jobpilot_applications WHERE id = ?', [r1.application_id]);
  await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);
});

test('getApplications returns user applications with job details', async () => {
  // 创建测试 job + 投递
  const [jr] = await pool.query(
    `INSERT INTO jobs (title, company, city, salary_min, salary_max, is_online, is_deleted, verify_status)
     VALUES ('jobpilot_test_job', 'TestCo', '深圳', 10, 20, 1, 0, 'verified')`
  );
  const jobId = jr.insertId;
  const ar = await matchService.applyToJob(TEST_USER, jobId, { hr_contact: 'hr@example.com' });

  const apps = await matchService.getApplications(TEST_USER);
  assert.ok(apps.length >= 1);

  const found = apps.find(a => a.id === ar.application_id);
  assert.ok(found);
  assert.equal(found.job.title, 'jobpilot_test_job');
  assert.equal(found.job.company, 'TestCo');
  assert.equal(found.job.city, '深圳');
  assert.equal(found.job.verify_status, 'verified');
  assert.equal(found.status, 'submitted');
  assert.equal(found.hr_contact, 'hr@example.com');
  assert.equal(found.needs_follow_up, true);  // 默认 3 天后,测试时间已过

  await pool.query('DELETE FROM jobpilot_applications WHERE id = ?', [ar.application_id]);
  await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);
});

test('updateApplicationStatus transitions submitted → viewed', async () => {
  const [jr] = await pool.query(
    `INSERT INTO jobs (title, company, city, salary_min, salary_max, is_online, is_deleted, verify_status)
     VALUES ('jobpilot_test_job', 'TestCo', '深圳', 10, 20, 1, 0, 'verified')`
  );
  const jobId = jr.insertId;
  const ar = await matchService.applyToJob(TEST_USER, jobId);

  // 更新状态
  await matchService.updateApplicationStatus(ar.application_id, TEST_USER, {
    status: 'viewed',
    note: 'HR 看了',
  });

  const apps = await matchService.getApplications(TEST_USER);
  const updated = apps.find(a => a.id === ar.application_id);
  assert.equal(updated.status, 'viewed');
  assert.equal(updated.note, 'HR 看了');
  assert.notEqual(updated.status_updated_at, updated.applied_at);

  await pool.query('DELETE FROM jobpilot_applications WHERE id = ?', [ar.application_id]);
  await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);
});

test('updateApplicationStatus rejects invalid status', async () => {
  const [jr] = await pool.query(
    `INSERT INTO jobs (title, company, city, salary_min, salary_max, is_online, is_deleted, verify_status)
     VALUES ('jobpilot_test_job', 'TestCo', '深圳', 10, 20, 1, 0, 'verified')`
  );
  const jobId = jr.insertId;
  const ar = await matchService.applyToJob(TEST_USER, jobId);

  await assert.rejects(
    matchService.updateApplicationStatus(ar.application_id, TEST_USER, { status: 'invalid_status_xyz' }),
    /invalid status/
  );

  await pool.query('DELETE FROM jobpilot_applications WHERE id = ?', [ar.application_id]);
  await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);
});

test('updateApplicationStatus with interview_at schedules interview', async () => {
  const [jr] = await pool.query(
    `INSERT INTO jobs (title, company, city, salary_min, salary_max, is_online, is_deleted, verify_status)
     VALUES ('jobpilot_test_job', 'TestCo', '深圳', 10, 20, 1, 0, 'verified')`
  );
  const jobId = jr.insertId;
  const ar = await matchService.applyToJob(TEST_USER, jobId);

  await matchService.updateApplicationStatus(ar.application_id, TEST_USER, {
    status: 'interview_scheduled',
    interview_at: '2026-08-01 14:00:00',
  });

  const apps = await matchService.getApplications(TEST_USER);
  const updated = apps.find(a => a.id === ar.application_id);
  assert.equal(updated.status, 'interview_scheduled');
  assert.ok(updated.interview_at);

  await pool.query('DELETE FROM jobpilot_applications WHERE id = ?', [ar.application_id]);
  await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);
});

test('needs_follow_up flag only true when status=submitted and follow_up_at past', async () => {
  const [jr] = await pool.query(
    `INSERT INTO jobs (title, company, city, salary_min, salary_max, is_online, is_deleted, verify_status)
     VALUES ('jobpilot_test_job', 'TestCo', '深圳', 10, 20, 1, 0, 'verified')`
  );
  const jobId = jr.insertId;
  const ar = await matchService.applyToJob(TEST_USER, jobId);

  // 默认 follow_up_at 是 NOW() + 3 days,needs_follow_up 应该 true
  let apps = await matchService.getApplications(TEST_USER);
  let found = apps.find(a => a.id === ar.application_id);
  assert.equal(found.needs_follow_up, true);

  // 改成 viewed 后,needs_follow_up 应该 false
  await matchService.updateApplicationStatus(ar.application_id, TEST_USER, { status: 'viewed' });
  apps = await matchService.getApplications(TEST_USER);
  found = apps.find(a => a.id === ar.application_id);
  assert.equal(found.needs_follow_up, false);

  await pool.query('DELETE FROM jobpilot_applications WHERE id = ?', [ar.application_id]);
  await pool.query('DELETE FROM jobs WHERE id = ?', [jobId]);
});

test.after(async () => {
  await pool.query('DELETE FROM jobpilot_applications WHERE user_id = ?', [TEST_USER]);
  await pool.query("DELETE FROM users WHERE openid = ?", [TEST_OPENID]);
  await pool.query("DELETE FROM jobs WHERE title = 'jobpilot_test_job'");
});