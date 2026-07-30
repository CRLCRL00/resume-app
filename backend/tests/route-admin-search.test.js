const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { sign } = require('../src/services/token');
const { getPool, cleanup } = require('./helpers/db');
const pool = getPool();

const ADMIN_OPENID = 'admin_search_test';
const NON_ADMIN_OPENID = 'nonadmin_search_test';
const NICK_USER_OPENID = 'nick_search_user';

// 跑前清干净
test.before(async () => {
  await pool.query("DELETE FROM admins WHERE openid IN (?, ?)", [ADMIN_OPENID, NON_ADMIN_OPENID]);
  await pool.query("INSERT INTO admins (openid, note) VALUES (?, 'search-test')", [ADMIN_OPENID]);

  // 准备 jobs 数据（不可变前缀以便清理）
  await pool.query("DELETE FROM jobs WHERE title LIKE 'search_test_%'");
  await pool.query(
    "INSERT INTO jobs (title, company, city, salary_min, salary_max, description_md, skills_required) VALUES " +
    "('search_test_engineer', 'AcmeCorp', '深圳', 10, 20, 'looking for backend engineer', '[]')," +
    "('search_test_manager', 'BetaCo', '北京', 15, 30, 'project manager wanted', '[]')," +
    "('search_test_other', 'GammaInc', '上海', 5, 10, 'no keyword here', '[]')"
  );

  // 准备 users 数据 — admin + 一个非 admin with nickname
  await pool.query("DELETE FROM users WHERE openid IN (?, ?)", [NICK_USER_OPENID, 'second_admin_openid']);
  await pool.query("INSERT INTO users (openid, nickname) VALUES (?, ?)", [NICK_USER_OPENID, 'search_nick_user']);
  await pool.query("INSERT INTO users (openid, nickname) VALUES ('second_admin_openid', 'search_second_nick')");
  await pool.query("INSERT INTO admins (openid, note) VALUES ('second_admin_openid', 'second')");

  // 准备 resumes（一个 user 关联 active resume）
  const [u] = await pool.query("SELECT id FROM users WHERE openid = ?", [NICK_USER_OPENID]);
  const userId = u[0].id;
  await pool.query("DELETE FROM resumes WHERE user_id = ?", [userId]);
  const sourceForm = JSON.stringify({
    name: 'search_tester_name',
    education: [{ school: 'search_school_univ' }],
    experience: [{ company: 'search_company_xyz' }],
  });
  await pool.query(
    "INSERT INTO resumes (user_id, content_md, source_form, is_active) VALUES (?, '', ?, 1)",
    [userId, sourceForm]
  );
});

test('GET /api/admin/jobs?q=engineer returns matching jobs only', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get('/api/admin/jobs?q=engineer')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data.items));
  assert.ok(res.body.data.items.length >= 1, 'should find at least one match');
  for (const it of res.body.data.items) {
    const hay = `${it.title || ''} ${it.company || ''} ${it.description_md || ''}`.toLowerCase();
    assert.ok(hay.includes('engineer'), `row does not contain 'engineer': ${JSON.stringify(it)}`);
  }
  assert.equal(res.body.data.q, 'engineer');
});

test('GET /api/admin/jobs?q=nomatchxxx returns empty items + total=0', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get('/api/admin/jobs?q=zzz_no_such_string_qq')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.items.length, 0);
  assert.equal(res.body.data.total, 0);
});

test('GET /api/admin/jobs?q= escapes % and _ wildcards (no SQL injection, no broad match)', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  // '%' should be treated as literal, not wildcard — should match nothing (no job title contains '%')
  const res = await request(createApp())
    .get('/api/admin/jobs?q=%25')  // %25 = encoded %
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.items.length, 0);
  assert.equal(res.body.data.total, 0);
});

test('GET /api/admin/users?q=admin returns admin rows', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get('/api/admin/users?q=second_admin_openid')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data.items));
  assert.ok(res.body.data.items.length >= 1);
  assert.equal(res.body.data.q, 'second_admin_openid');
});

test('GET /api/admin/users?q= matches nickname via LEFT JOIN users', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get('/api/admin/users?q=search_second_nick')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.items.length, 1);
  assert.equal(res.body.data.items[0].openid, 'second_admin_openid');
  assert.equal(res.body.data.items[0].nickname, 'search_second_nick');
});

test('GET /api/admin/jobs?q= combined with page/pageSize works', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get('/api/admin/jobs?q=search_test&page=1&pageSize=2')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.page, 1);
  assert.equal(res.body.data.pageSize, 2);
  assert.ok(res.body.data.items.length <= 2);
  assert.ok(res.body.data.total >= 1);
  assert.equal(res.body.data.q, 'search_test');
});

test('GET /api/admin/resumes/search?q= returns matching resumes', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const res = await request(createApp())
    .get('/api/admin/resumes/search?q=search_school_univ')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data.items));
  assert.ok(res.body.data.items.length >= 1, 'should find at least one matching resume');
  assert.equal(res.body.data.q, 'search_school_univ');
});

test('SQL injection attempt on ?q= is safely parameterized', async () => {
  const token = sign({ userId: 999, openid: ADMIN_OPENID });
  const malicious = "'; DROP TABLE jobs; --";
  const res = await request(createApp())
    .get(`/api/admin/jobs?q=${encodeURIComponent(malicious)}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  // jobs 表必须仍存在 — 跑个 COUNT 验证
  const [r] = await pool.query('SELECT COUNT(*) AS c FROM jobs');
  assert.ok(r[0].c >= 1, 'jobs table must still exist and have rows');
  // 应当把整个 string 当 literal 搜，几乎肯定 0 hits
  assert.equal(res.body.data.total, 0);
  assert.equal(res.body.data.items.length, 0);
});

test.after(async () => {
  await pool.query("DELETE FROM jobs WHERE title LIKE 'search_test_%'");
  await pool.query("DELETE FROM resumes WHERE user_id IN (SELECT id FROM users WHERE openid IN (?, 'second_admin_openid'))", [NICK_USER_OPENID]);
  await pool.query("DELETE FROM users WHERE openid IN (?, 'second_admin_openid')", [NICK_USER_OPENID]);
  await pool.query("DELETE FROM admins WHERE openid IN (?, 'second_admin_openid')", [ADMIN_OPENID]);
  await pool.query("DELETE FROM admin_operation_logs WHERE admin_openid = ?", [ADMIN_OPENID]);
  await cleanup();
});
