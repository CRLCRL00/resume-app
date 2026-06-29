const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { getPool, cleanup } = require('./helpers/db');
const pool = getPool();

test('GET /api/jobs/:id with invalid id returns 400', async () => {
  const res = await request(createApp()).get('/api/jobs/abc');
  assert.equal(res.status, 400);
});

test('GET /api/jobs/:id with non-existent id returns 404', async () => {
  const res = await request(createApp()).get('/api/jobs/99999');
  assert.equal(res.status, 404);
});

test('GET /api/jobs/:id returns job with parsed skills', async () => {
  const [r] = await pool.query(
    "INSERT INTO jobs (title, company, city, salary_min, salary_max, description_md, skills_required, is_online, is_deleted) VALUES ('route_test', 'TestCo', '深圳', 10, 20, 'desc', '[\"React\",\"Vue\"]', 1, 0)"
  );
  const res = await request(createApp()).get(`/api/jobs/${r.insertId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.title, 'route_test');
  assert.deepEqual(res.body.data.skills_required, ['React', 'Vue']);
  await pool.query('DELETE FROM jobs WHERE id = ?', [r.insertId]);
});

test.after(async () => {
  await cleanup();
});
