/**
 * Full backend e2e smoke (real network calls to the configured BASE_URL).
 *
 * Tests:
 *   - GET  /api/health
 *   - GET  /api/legal/privacy
 *   - GET  /api/legal/terms
 *   - GET  /api/jobs/1
 *   - POST /api/auth/wx-login (via route 401 path, since real wx code needs network)
 *   - POST /api/auth/wx-login mock (DEV shortcut if backend supports it)
 *   - GET  /api/resume/current (with token)
 *   - POST /api/resume/save (with token)
 *   - POST /api/resume/generate (with token + resume_id, real LLM)
 *   - POST /api/match (with token + resume_id, real LLM)
 *   - GET  /api/admin/jobs (admin token)
 *
 * Usage:
 *   node scripts/smoke-e2e.js
 *   BASE_URL=https://43.139.176.199 node scripts/smoke-e2e.js
 */

const http = require('http');
const https = require('https');
const path = require('path');

// Resolve BASE_URL
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3003';
const ADMIN_OPENID = process.env.ADMIN_OPENID || 'admin_test_openid';
const USER_OPENID = process.env.USER_OPENID || 'user_test_openid';
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'resume_app';

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
// Allow CLI to override JWT_SECRET so smoke signs with the same secret
// the server uses (locally we may have a different dev secret than prod).
if (process.env.JWT_SECRET_OVERRIDE) {
  process.env.JWT_SECRET = process.env.JWT_SECRET_OVERRIDE;
}
const token = require('../src/services/token');
const mysql = require('mysql2/promise');

let pass = 0, fail = 0;
const fails = [];

async function ensureUser(openid, isAdmin = false) {
  // Connect to server DB (allow override via SMOKE_DB_* env)
  const dbHost = process.env.SMOKE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const dbUser = process.env.SMOKE_DB_USER || process.env.DB_USER;
  const dbPass = process.env.SMOKE_DB_PASS || process.env.DB_PASSWORD;
  const dbName = process.env.SMOKE_DB_NAME || process.env.DB_NAME;
  const conn = await mysql.createConnection({
    host: dbHost, user: dbUser, password: dbPass, database: dbName,
  });
  await conn.query('INSERT IGNORE INTO users (openid) VALUES (?)', [openid]);
  if (isAdmin) {
    await conn.query('INSERT IGNORE INTO admins (openid, note) VALUES (?, ?)', [openid, 'smoke']);
  }
  const [rows] = await conn.query('SELECT id FROM users WHERE openid = ?', [openid]);
  await conn.end();
  return rows[0].id;
}

async function req(method, p, body, headers = {}) {
  const url = new URL(BASE_URL + p);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const r = lib.request(opts, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✔ ${name}`); }
  else { fail++; fails.push({ name, extra }); console.log(`✖ ${name} ${extra}`); }
}

async function main() {
  console.log(`Smoke against: ${BASE_URL}\n`);

  // Setup users in DB
  let adminId, userId;
  try {
    adminId = await ensureUser(ADMIN_OPENID, true);
    userId = await ensureUser(USER_OPENID);
  } catch (e) {
    console.log(`Setup DB err: ${e.message}`);
    process.exit(1);
  }

  const adminToken = token.sign({ userId: adminId, openid: ADMIN_OPENID });
  const userToken = token.sign({ userId: userId, openid: USER_OPENID });
  const auth = (t) => ({ Authorization: 'Bearer ' + t });

  // 1. health
  let r = await req('GET', '/api/health');
  check('GET /api/health', r.status === 200 && r.body?.data?.status === 'ok', JSON.stringify(r.body).slice(0,100));

  // 2. legal privacy
  r = await req('GET', '/api/legal/privacy');
  check('GET /api/legal/privacy', r.status === 200 && /隐私/.test(r.body?.data?.title || ''), '');

  // 3. legal terms
  r = await req('GET', '/api/legal/terms');
  check('GET /api/legal/terms', r.status === 200 && /服务/.test(r.body?.data?.title || ''), '');

  // 4. jobs detail
  r = await req('GET', '/api/jobs/1');
  check('GET /api/jobs/1', r.status === 200 || r.status === 404, '');

  // 5. wx-login route exists
  r = await req('POST', '/api/auth/wx-login', { code: 'invalid' });
  check('POST /api/auth/wx-login reachable', r.status === 401 || r.status === 502 || r.status === 400, '');

  // 6. resume current (no token)
  r = await req('GET', '/api/resume/current');
  check('GET /api/resume/current (no token) → 401', r.status === 401, '');

  // 7. resume save + current
  const validForm = {
    source_form: {
      name: 'E2E', gender: 'male', degree: '本科', phone: '',
      educations: [{ school: 's', major: 'm', degree: 'd', start: '2020-01', end: '至今' }],
      experiences: [{ company: 'c', title: 't', start: '2021-01', end: '至今', desc: 'd' }],
      expected: { city: '深圳', position: '前端', salary_min: 10, salary_max: 20 },
      skills: ['React'],
    },
  };
  r = await req('POST', '/api/resume/save', validForm, auth(userToken));
  const resumeId = r.body?.data?.resume_id;
  check('POST /api/resume/save (token)', r.status === 200 && resumeId > 0, JSON.stringify(r.body).slice(0,150));

  r = await req('GET', '/api/resume/current', null, auth(userToken));
  check('GET /api/resume/current (token)', r.status === 200 && r.body?.data?.resume_id === resumeId, '');

  // 8. resume generate (real LLM)
  try {
    r = await req('POST', '/api/resume/generate', { resume_id: resumeId }, auth(userToken));
    const genOk = r.status === 200 && r.body?.data?.content_md?.length > 50;
    check('POST /api/resume/generate (real LLM)', genOk, genOk ? '' : `status=${r.status} msg=${(r.body?.message||'').slice(0,120)}`);
  } catch (e) { check('POST /api/resume/generate (real LLM)', false, e.message); }

  // 9. match (real LLM)
  try {
    r = await req('POST', '/api/match', { resume_id: resumeId }, auth(userToken));
    const matchOk = r.status === 200 || r.status === 200;
    check('POST /api/match (real LLM)', matchOk, `status=${r.status} batch=${!!r.body?.data?.batch_id}`);
  } catch (e) { check('POST /api/match (real LLM)', false, e.message); }

  // 10. admin list (admin token) — REQUIRES the server admins table to contain this openid.
  //     smoke seeds admin via ensureUser() only when SMOKE_DB_HOST points at server DB.
  //     Otherwise skip with a warning.
  if (!process.env.SMOKE_DB_HOST) {
    console.log(`⚠ SKIP /api/admin/jobs — set SMOKE_DB_HOST etc. to seed server admins table`);
  } else {
    r = await req('GET', '/api/admin/jobs?page=1&page_size=10', null, auth(adminToken));
    check('GET /api/admin/jobs (admin)', r.status === 200 && Array.isArray(r.body?.data?.items), JSON.stringify(r.body).slice(0,150));
  }

  // 11. cleanup: delete test resume
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST, user: process.env.DB_USER,
      password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    });
    await conn.query('DELETE FROM resumes WHERE user_id = ?', [userId]);
    await conn.query('DELETE FROM users WHERE openid IN (?, ?)', [ADMIN_OPENID, USER_OPENID]);
    await conn.end();
  } catch {}

  console.log(`\nResult: ${pass} pass, ${fail} fail`);
  if (fail) {
    fails.forEach(f => console.log(` - ${f.name}: ${f.extra}`));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
