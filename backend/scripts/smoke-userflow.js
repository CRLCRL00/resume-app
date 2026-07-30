/**
 * Full user-flow smoke simulating what mini-program does.
 * Validates full request/response shape including the res.data.data.* pattern.
 */
const http = require('http');
const https = require('https');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3003';
const JWT_SECRET = process.env.JWT_SECRET_OVERRIDE || 'resume-app-jwt-secret-2026-prod-only';
process.env.JWT_SECRET = JWT_SECRET;

const token = require('../src/services/token');
const mysql = require('mysql2/promise');

let pass = 0, fail = 0;
const fails = [];

function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✔ ${name}`); }
  else { fail++; fails.push({ name, extra }); console.log(`✖ ${name} ${extra.slice(0,200)}`); }
}

async function req(method, p, body, jwt) {
  const url = new URL(BASE_URL + p);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}),
      },
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

async function setupUser(openid) {
  const dbHost = process.env.SMOKE_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  const dbUser = process.env.SMOKE_DB_USER || process.env.DB_USER;
  const dbPass = process.env.SMOKE_DB_PASS || process.env.DB_PASSWORD;
  const dbName = process.env.SMOKE_DB_NAME || process.env.DB_NAME;
  const conn = await mysql.createConnection({
    host: dbHost, user: dbUser, password: dbPass, database: dbName,
  });
  await conn.query('INSERT IGNORE INTO users (openid) VALUES (?)', [openid]);
  const [rows] = await conn.query('SELECT id FROM users WHERE openid = ?', [openid]);
  await conn.end();
  return rows[0].id;
}

async function main() {
  console.log(`User-flow smoke against: ${BASE_URL}\n`);
  // Use provided userId (default to a fixed test user created on server)
  const userId = parseInt(process.env.TEST_USER_ID, 10) || 8;
  const openid = process.env.TEST_OPENID || 'flow_test_20820';
  const jwt = token.sign({ userId, openid });
  const auth = jwt;

  // ─── form save (mini-program form.submit) ───
  const form = {
    source_form: {
      name: '测试', gender: 'male', degree: '本科', phone: '',
      educations: [{ school: 's', major: 'm', degree: 'd', start: '2020-01', end: '至今' }],
      experiences: [{ company: 'c', title: 't', start: '2021-01', end: '至今', desc: 'd' }],
      expected: { city: '深圳', position: '前端', salary_min: 10, salary_max: 20 },
      skills: ['React'],
    },
  };
  let r = await req('POST', '/api/resume/save', form, auth);
  const saveData = r.body?.data || {};
  check('POST /api/resume/save → body.code=0 data.resume_id>0',
    r.status === 200 && r.body.code === 0 && saveData.resume_id > 0,
    JSON.stringify(r.body).slice(0, 200));
  const rid = saveData.resume_id;

  // ─── form auto-generate ───
  r = await req('POST', '/api/resume/generate', { resume_id: rid }, auth);
  const genData = r.body?.data || {};
  check('POST /api/resume/generate → body.code=0 data.content_md.length>50',
    r.status === 200 && r.body.code === 0 && (genData.content_md || '').length > 50,
    JSON.stringify(r.body).slice(0, 200));

  // ─── preview.js load() ───
  r = await req('GET', '/api/resume/current', null, auth);
  const curData = r.body?.data || {};
  check('GET /api/resume/current → body.code=0 data.resume_id==rid data.content_md.length>50',
    r.status === 200 && r.body.code === 0 && curData.resume_id === rid &&
    (curData.content_md || '').length > 50,
    JSON.stringify({ expected: rid, got: curData.resume_id }).slice(0, 200));

  // ─── match/list.js load() then match() ───
  r = await req('POST', '/api/match', { resume_id: rid }, auth);
  const matchData = r.body?.data || {};
  check('POST /api/match → body.code=0 data.batch_id data.results array',
    r.status === 200 && r.body.code === 0 && !!matchData.batch_id && Array.isArray(matchData.results),
    JSON.stringify(Object.keys(r.body?.data || {})).slice(0, 200));

  // ─── match/detail.js fetch job by id ───
  if (matchData.results && matchData.results.length) {
    const firstJobId = matchData.results[0].job_id;
    r = await req('GET', '/api/jobs/' + firstJobId);
    const job = r.body?.data || {};
    check(`GET /api/jobs/${firstJobId} → body.code=0 data.id>0 data.title`,
      r.status === 200 && r.body.code === 0 && job.id > 0 && !!job.title,
      JSON.stringify({ expected_id: firstJobId, got: { id: job.id, title: job.title } }).slice(0, 200));
  }

  // ─── admin/check (app.js checkAdmin) ───
  // Note: /admin/check uses adminAuth middleware — non-admin gets 403 (app.js treats that as isAdmin=false)
  r = await req('GET', '/api/admin/check', null, auth);
  check('GET /api/admin/check → 403 for non-admin (expected)',
    r.status === 403 || (r.status === 200 && r.body?.data?.isAdmin === false),
    JSON.stringify(r.body).slice(0, 200));

  // cleanup
  try {
    const conn = await mysql.createConnection({
      host: process.env.SMOKE_DB_HOST || process.env.DB_HOST,
      user: process.env.SMOKE_DB_USER || process.env.DB_USER,
      password: process.env.SMOKE_DB_PASS || process.env.DB_PASSWORD,
      database: process.env.SMOKE_DB_NAME || process.env.DB_NAME,
    });
    await conn.query('DELETE FROM resumes WHERE user_id = ?', [userId]);
    await conn.query('DELETE FROM users WHERE openid LIKE "flow_test_%"', []);
    await conn.end();
  } catch {}

  console.log(`\nResult: ${pass} pass, ${fail} fail`);
  if (fail) {
    fails.forEach(f => console.log(` - ${f.name}: ${f.extra.slice(0, 200)}`));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
