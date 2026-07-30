const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { sign } = require('../src/services/token');
const { getPool, cleanup } = require('./helpers/db');
const pool = getPool();

const ADMIN_OPENID = 'jobs_route_test_admin';
const TITLE = 'jobs_route_test_job';

test.before(async () => {
  await pool.query("DELETE FROM admins WHERE openid = ?", [ADMIN_OPENID]);
  await pool.query("INSERT INTO admins (openid, note) VALUES (?, 'jobs-test')", [ADMIN_OPENID]);
  await pool.query("DELETE FROM jobs WHERE title = ?", [TITLE]);
});

test('GET /api/jobs/:id with invalid id returns 400', async () => {
  const res = await request(createApp()).get('/api/jobs/abc');
  assert.equal(res.status, 400);
});

test('GET /api/jobs/:id with non-existent id returns 404', async () => {
  const res = await request(createApp()).get('/api/jobs/9999999');
  assert.equal(res.status, 404);
});

test('GET /api/jobs/:id returns job with parsed skills', async () => {
  const [r] = await pool.query(
    "INSERT INTO jobs (title, company, city, salary_min, salary_max, description_md, skills_required, is_online, is_deleted) VALUES (?, 'TestCo', '深圳', 10, 20, 'desc', '[\"React\",\"Vue\"]', 1, 0)",
    [TITLE]
  );
  const id = r.insertId;
  const res = await request(createApp()).get(`/api/jobs/${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.title, TITLE);
  assert.deepEqual(res.body.data.skills_required, ['React', 'Vue']);
  assert.equal(res.body.data.is_online, 1);
  await pool.query('DELETE FROM jobs WHERE id = ?', [id]);
});

test('GET /api/jobs/:id for soft-deleted job returns 404', async () => {
  const [r] = await pool.query(
    "INSERT INTO jobs (title, company, city, salary_min, salary_max, description_md, skills_required, is_online, is_deleted) VALUES (?, 'TestCo', '深圳', 10, 20, 'desc', '[]', 1, 1)",
    [TITLE]
  );
  const id = r.insertId;
  const res = await request(createApp()).get(`/api/jobs/${id}`);
  assert.equal(res.status, 404);
  await pool.query('DELETE FROM jobs WHERE id = ?', [id]);
});

test('GET /api/jobs/:id for offline job returns 404', async () => {
  const [r] = await pool.query(
    "INSERT INTO jobs (title, company, city, salary_min, salary_max, description_md, skills_required, is_online, is_deleted) VALUES (?, 'TestCo', '深圳', 10, 20, 'desc', '[]', 0, 0)",
    [TITLE]
  );
  const id = r.insertId;
  const res = await request(createApp()).get(`/api/jobs/${id}`);
  assert.equal(res.status, 404);
  await pool.query('DELETE FROM jobs WHERE id = ?', [id]);
});

test('POST /api/admin/jobs without token returns 401', async () => {
  const res = await request(createApp())
    .post('/api/admin/jobs')
    .send({ title: TITLE, company: 'c', city: 'x', salary_min: 1, salary_max: 2, description_md: 'd' });
  assert.equal(res.status, 401);
});

test('POST /api/admin/jobs with non-admin token returns 403', async () => {
  const token = sign({ userId: 1, openid: 'not_admin_xyz' });
  const res = await request(createApp())
    .post('/api/admin/jobs')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: TITLE, company: 'c', city: 'x', salary_min: 1, salary_max: 2, description_md: 'd' });
  assert.equal(res.status, 403);
});

test('POST /api/admin/jobs validation: missing title returns 400', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .post('/api/admin/jobs')
    .set('Authorization', `Bearer ${token}`)
    .send({ company: 'c', city: 'x', salary_min: 1, salary_max: 2, description_md: 'd' });
  assert.equal(res.status, 400);
});

test('POST /api/admin/jobs happy path returns job_id', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .post('/api/admin/jobs')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: TITLE, company: 'TestCo', city: '深圳',
      salary_min: 10, salary_max: 20, description_md: 'desc',
      skills_required: ['React'],
    });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.job_id);
  await pool.query('DELETE FROM jobs WHERE id = ?', [res.body.data.job_id]);
  await pool.query('DELETE FROM admin_operation_logs WHERE target_id = ?', [String(res.body.data.job_id)]);
});

test('PUT /api/admin/jobs/:id updates fields', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const [r] = await pool.query(
    "INSERT INTO jobs (title, company, city, salary_min, salary_max, description_md, skills_required) VALUES (?, 'TestCo', '深圳', 10, 20, 'desc', '[]')",
    [TITLE]
  );
  const id = r.insertId;
  const res = await request(createApp())
    .put(`/api/admin/jobs/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: TITLE, company: 'TestCo', city: '北京',
      salary_min: 12, salary_max: 22, description_md: 'new desc',
      skills_required: ['Go'],
    });
  assert.equal(res.status, 200);
  const [rows] = await pool.query('SELECT city, salary_min FROM jobs WHERE id = ?', [id]);
  assert.equal(rows[0].city, '北京');
  assert.equal(rows[0].salary_min, 12);
  await pool.query('DELETE FROM jobs WHERE id = ?', [id]);
  await pool.query('DELETE FROM admin_operation_logs WHERE target_id = ?', [String(id)]);
});

test('DELETE /api/admin/jobs/:id soft-deletes (sets is_deleted=1)', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const [r] = await pool.query(
    "INSERT INTO jobs (title, company, city, salary_min, salary_max, description_md, skills_required) VALUES (?, 'TestCo', '深圳', 10, 20, 'desc', '[]')",
    [TITLE]
  );
  const id = r.insertId;
  const res = await request(createApp())
    .delete(`/api/admin/jobs/${id}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  const [rows] = await pool.query('SELECT is_deleted FROM jobs WHERE id = ?', [id]);
  assert.equal(rows[0].is_deleted, 1);
  await pool.query('DELETE FROM jobs WHERE id = ?', [id]);
  await pool.query('DELETE FROM admin_operation_logs WHERE target_id = ?', [String(id)]);
});

test.after(async () => {
  await pool.query("DELETE FROM jobs WHERE title = ?", [TITLE]);
  await pool.query("DELETE FROM admins WHERE openid = ?", [ADMIN_OPENID]);
  await cleanup();
});
