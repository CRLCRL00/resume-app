const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { sign } = require('../src/services/token');
const { getPool, cleanup } = require('./helpers/db');
const pool = getPool();

// 临时 admin openid（测试完清掉）
const ADMIN_OPENID = 'admin_phase4_test';

test.before(async () => {
  await pool.query("DELETE FROM admins WHERE openid = ?", [ADMIN_OPENID]);
  await pool.query("INSERT INTO admins (openid, note) VALUES (?, 'phase4-test')", [ADMIN_OPENID]);
  await pool.query("DELETE FROM jobs WHERE title = 'test-job'");
});

test('GET /api/admin/jobs without token returns 401', async () => {
  const res = await request(createApp()).get('/api/admin/jobs');
  assert.equal(res.status, 401);
});

test('GET /api/admin/jobs with non-admin returns 403', async () => {
  const token = sign({ userId: 1, openid: 'non_admin_xxx' });
  const res = await request(createApp())
    .get('/api/admin/jobs')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 403);
});

test('POST /api/admin/jobs creates a job', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .post('/api/admin/jobs')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'test-job', company: 'TestCo', city: '深圳',
      salary_min: 10, salary_max: 20, description_md: 'desc',
    });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.job_id);
  // log 记录
  const [logs] = await pool.query(
    "SELECT * FROM admin_operation_logs WHERE target_id = ? AND action = 'job.create'",
    [String(res.body.data.job_id)]
  );
  assert.ok(logs.length);
});

test('POST /api/admin/jobs with salary_max < salary_min returns 400', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .post('/api/admin/jobs')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 't', company: 'c', city: 'x',
      salary_min: 20, salary_max: 10, description_md: 'd',
    });
  assert.equal(res.status, 400);
});

test('GET /api/admin/jobs lists jobs with pagination', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get('/api/admin/jobs?page=1&pageSize=5')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data.items));
  assert.equal(res.body.data.page, 1);
  assert.equal(res.body.data.pageSize, 5);
  assert.ok(typeof res.body.data.total === 'number');
});

test('PUT /api/admin/jobs/:id updates a job', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const [r] = await pool.query(
    "INSERT INTO jobs (title, company, city, salary_min, salary_max, description_md, skills_required) VALUES ('test-job','TestCo','深圳',10,20,'desc','[]')"
  );
  const id = r.insertId;
  const res = await request(createApp())
    .put(`/api/admin/jobs/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'updated', company: 'TestCo', city: '北京', salary_min: 12, salary_max: 22, description_md: 'new desc' });
  assert.equal(res.status, 200);
  const [rows] = await pool.query('SELECT title, city FROM jobs WHERE id = ?', [id]);
  assert.equal(rows[0].title, 'updated');
  assert.equal(rows[0].city, '北京');
  await pool.query('DELETE FROM jobs WHERE id = ?', [id]);
});

test('PATCH /api/admin/jobs/:id/online toggles online', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const [r] = await pool.query(
    "INSERT INTO jobs (title, company, city, salary_min, salary_max, description_md, skills_required) VALUES ('test-job','TestCo','深圳',10,20,'desc','[]')"
  );
  const id = r.insertId;
  const res = await request(createApp())
    .patch(`/api/admin/jobs/${id}/online`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  const [rows] = await pool.query('SELECT is_online FROM jobs WHERE id = ?', [id]);
  assert.equal(rows[0].is_online, 0);
  await pool.query('DELETE FROM jobs WHERE id = ?', [id]);
});

test('DELETE /api/admin/jobs/:id soft deletes', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const [r] = await pool.query(
    "INSERT INTO jobs (title, company, city, salary_min, salary_max, description_md, skills_required) VALUES ('test-job','TestCo','深圳',10,20,'desc','[]')"
  );
  const id = r.insertId;
  const res = await request(createApp())
    .delete(`/api/admin/jobs/${id}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  const [rows] = await pool.query('SELECT is_deleted FROM jobs WHERE id = ?', [id]);
  assert.equal(rows[0].is_deleted, 1);
  await pool.query('DELETE FROM jobs WHERE id = ?', [id]);
});

test('PATCH /api/admin/jobs/:id/restore restores', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const [r] = await pool.query(
    "INSERT INTO jobs (title, company, city, salary_min, salary_max, description_md, skills_required, is_deleted) VALUES ('test-job','TestCo','深圳',10,20,'desc','[]',1)"
  );
  const id = r.insertId;
  const res = await request(createApp())
    .patch(`/api/admin/jobs/${id}/restore`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  const [rows] = await pool.query('SELECT is_deleted FROM jobs WHERE id = ?', [id]);
  assert.equal(rows[0].is_deleted, 0);
  await pool.query('DELETE FROM jobs WHERE id = ?', [id]);
});

test.after(async () => {
  await pool.query("DELETE FROM jobs WHERE title = 'test-job' OR title = 'updated'");
  await pool.query("DELETE FROM admins WHERE openid = ?", [ADMIN_OPENID]);
  await pool.query("DELETE FROM admin_operation_logs WHERE admin_openid = ?", [ADMIN_OPENID]);
  await cleanup();
});