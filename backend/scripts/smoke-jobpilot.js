/**
 * Jobpilot routes smoke test — 一键验证 5 步流 API 都活着 + 返回 schema 正确。
 *
 * 测试覆盖（不依赖 DB write 操作，只验 schema）:
 *   - POST /api/jobpilot/profile-diagnose → 返回 image/confidence/recommendedJobs
 *   - POST /api/jobpilot/project-score    → 返回 score/breakdown/storyPoints
 *   - GET  /api/match/applications        → 返回 applications 数组（可为 []）
 *   - POST /api/match                     → 需要 resume_id (admin 测试时跳过)
 *   - POST /api/resume/generate           → 需要 resume_id (跳过)
 *
 * Usage:
 *   node scripts/smoke-jobpilot.js
 *   BASE_URL=https://43.139.176.199 node scripts/smoke-jobpilot.js
 *   TOKEN=<jwt> node scripts/smoke-jobpilot.js
 *
 * 返回：
 *   0 = 全部 pass
 *   1 = 任一 fail
 */

const http = require('http');
const https = require('https');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3003';
const TOKEN = process.env.TOKEN || ''; // 必须：Bearer token
const SKIP_AUTH = process.env.SKIP_AUTH === '1';

let pass = 0, fail = 0;
const fails = [];

function ok(name) { pass++; console.log(`  ✓ ${name}`); }
function ng(name, msg) { fail++; fails.push({ name, msg }); console.log(`  ✗ ${name}: ${msg}`); }

async function req(method, p, body) {
  const url = new URL(BASE_URL + p);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (!SKIP_AUTH && TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers };
    const r = lib.request(opts, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(buf); } catch (e) { parsed = buf; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function assertSchema(obj, fields, name) {
  for (const f of fields) {
    if (!(f in obj)) {
      ng(name, `missing field "${f}" in ${JSON.stringify(obj).slice(0, 200)}`);
      return false;
    }
  }
  return true;
}

async function testProfileDiagnose() {
  const name = 'POST /api/jobpilot/profile-diagnose';
  try {
    const res = await req('POST', '/api/jobpilot/profile-diagnose', {
      education: '本科',
      aiAbility: 'AI 协作',
      projects: '简历 app + DeepSeek integration',
      target: '实习',
      timeline: '立刻',
    });
    if (res.status !== 200) return ng(name, `status ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
    if (res.data.code !== 0) return ng(name, `code=${res.data.code}: ${res.data.message || res.data.error}`);
    if (!assertSchema(res.data.data || {}, ['image', 'confidence', 'resumeStrategy', 'recommendedJobs'], name)) return;
    ok(`${name} → image="${res.data.data.image}" confidence=${res.data.data.confidence}`);
  } catch (e) {
    ng(name, `threw: ${e.message}`);
  }
}

async function testProjectScore() {
  const name = 'POST /api/jobpilot/project-score';
  try {
    const res = await req('POST', '/api/jobpilot/project-score', {
      name: '简历推荐小程序',
      techStack: 'Express + MySQL + DeepSeek LLM',
      aiCollaboration: '用 Claude 协作 90% 代码,我负责 review + 测试 + 部署',
      myRole: '项目负责人',
      url: 'https://github.com/CRLCRL00/resume-app',
    });
    if (res.status !== 200) return ng(name, `status ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
    if (res.data.code !== 0) return ng(name, `code=${res.data.code}: ${res.data.message || res.data.error}`);
    if (!assertSchema(res.data.data || {}, ['score', 'breakdown', 'improvements', 'storyPoints'], name)) return;
    ok(`${name} → score=${res.data.data.score} breakdown=${Object.keys(res.data.data.breakdown).join('/')}`);
  } catch (e) {
    ng(name, `threw: ${e.message}`);
  }
}

async function testApplications() {
  const name = 'GET /api/match/applications';
  try {
    const res = await req('GET', '/api/match/applications');
    if (res.status === 401) {
      console.log(`  ⚠ ${name} → 401 (no token); set TOKEN env to test`);
      return; // 401 不算 fail，是预期（user 没登录）
    }
    if (res.status !== 200) return ng(name, `status ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
    if (res.data.code !== 0) return ng(name, `code=${res.data.code}: ${res.data.message}`);
    if (!Array.isArray(res.data.data?.applications)) return ng(name, `applications not array: ${JSON.stringify(res.data).slice(0, 200)}`);
    ok(`${name} → ${res.data.data.applications.length} applications`);
  } catch (e) {
    ng(name, `threw: ${e.message}`);
  }
}

async function testHealth() {
  const name = 'GET /api/health (basic sanity)';
  try {
    const res = await req('GET', '/api/health');
    if (res.status !== 200) return ng(name, `status ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
    ok(`${name} → ${res.data.data?.status || 'ok'}`);
  } catch (e) {
    ng(name, `threw: ${e.message}`);
  }
}

async function main() {
  console.log(`\n=== Jobpilot smoke ===`);
  console.log(`BASE_URL: ${BASE_URL}`);
  console.log(`TOKEN: ${TOKEN ? '***' + TOKEN.slice(-6) : '(none — auth-required routes may 401)'}`);
  console.log('');

  await testHealth();
  await testProfileDiagnose();
  await testProjectScore();
  await testApplications();

  console.log(`\n=== Result ===`);
  console.log(`Pass: ${pass}, Fail: ${fail}`);
  if (fail > 0) {
    console.log('\nFailed cases:');
    for (const f of fails) console.log(`  - ${f.name}: ${f.msg}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
