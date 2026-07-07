/**
 * perf-bench.js — p95/p99 latency + throughput baseline for 4 hot endpoints.
 *
 * Usage:
 *   npm run perf:bench              # 2000ms p99, 10s each
 *   npm run perf:bench:ci           # 1500ms p99, 5s each
 *   BENCH_P99_MS=1500 node scripts/perf-bench.js
 *
 * Boots createApp() on 127.0.0.1:0, drives autocannon sequentially, emits
 * JSON per endpoint + a final PERF BENCH REPORT. Exit 1 if any p99 over
 * BENCH_P99_MS. Rate-limit middleware bypassed via require.cache injection
 * so we measure route+DB+LLM-mock latency, not 429 saturation.
 */
const path = require('node:path');

// 1. Mock externals BEFORE app boots (require.cache injection).
const { mockWechat, mockLlm } = require('../tests/e2e/helpers/mocks');
mockWechat({ 'bench-admin-code': 'bench-admin', 'bench-user-code': 'bench-user' });
mockLlm('# bench mock resume\n## section');

// 2. Bypass rate limiters (services/rateLimit + sliding + express-rate-limit
// middleware). Otherwise autocannon's 5 concurrent conns 429-spam instantly.
function stubModule(absPath, exports) {
  require.cache[require.resolve(absPath)] = {
    id: absPath, filename: absPath, loaded: true, exports, paths: [],
  };
}
const noopMw = (req, res, next) => next();
const backendRoot = path.join(__dirname, '..');
stubModule(path.join(backendRoot, 'src/services/rateLimit'), {
  check: async () => ({ allowed: true, count: 0, remaining: 999 }),
});
stubModule(path.join(backendRoot, 'src/middleware/slidingRateLimit'), {
  slidingRateLimitMiddleware: () => noopMw,
  slidingRateLimit: async () => ({ allowed: true, count: 0, remaining: 999 }),
});
stubModule(path.join(backendRoot, 'src/middleware/rateLimit'), {
  resumeLimiter: noopMw, matchLimiter: noopMw,
});

// 3. Load app + config.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const autocannon = require('autocannon');
const { createApp } = require('../src/app');
const pool = require('../src/config/db');
const redis = require('../src/config/redis');
const logger = require('../src/utils/logger');

const P99_MS = Number(process.env.BENCH_P99_MS) || 2000;
const DURATION = Number(process.env.BENCH_DURATION) || 10;

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

function summary(name, result) {
  const lat = result.latency || {}, thr = result.requests || {};
  return {
    endpoint: name,
    latency: { p50: lat.p50 || 0, p95: lat.p97_5 || lat.p95 || 0, p99: lat.p99 || 0, max: lat.max || 0 },
    throughput: { avg: thr.average || 0, min: thr.min || 0, max: thr.max || 0 },
    errors: result.errors || 0, non2xx: result.non2xx || 0, '2xx': result['2xx'] || 0,
    duration_s: DURATION, samples: result.requests?.sent,
  };
}

function runOne(target) {
  return new Promise((resolve, reject) => {
    const inst = autocannon({
      url: target.url, method: target.method, headers: target.headers || {},
      body: target.body, connections: target.connections, duration: DURATION, pipelining: 1,
    }, (err, result) => (err ? reject(err) : resolve(result)));
    autocannon.track(inst, { renderProgressBar: false, renderResultsTable: false });
    inst.on('done', () => {});
  });
}

async function login(port, code) {
  const r = await fetchJson(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (r.status !== 200 || r.body?.code !== 0) {
    throw new Error(`login failed for code=${code}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  return r.body.data; // { token, csrfToken, user, ... }
}

async function seed() {
  await pool.query("INSERT IGNORE INTO users (openid, nickname) VALUES (?, ?)", ['bench-admin', 'Bench Admin']);
  await pool.query("INSERT IGNORE INTO users (openid, nickname) VALUES (?, ?)", ['bench-user', 'Bench User']);
  await pool.query("INSERT IGNORE INTO admins (openid, note) VALUES (?, ?)", ['bench-admin', 'bench']);
}

async function clearRateLimits() {
  // Past runs pollute Redis — clear before bench so login (5/15min) etc. don't 429.
  const patterns = ['login:*', 'auth:*', 'match:*', 'generate:*', 'csrf:*', '2fa:*'];
  const all = [];
  for (const p of patterns) {
    try { all.push(...(await redis.keys(p))); } catch (_e) { /* ignore */ }
  }
  if (all.length) { try { await redis.del(...all); } catch (_e) { /* ignore */ } }
}

const RESUME_FIXTURE = {
  name: 'Bench User', gender: 'male', degree: '本科', phone: '13800000000',
  educations: [{ school: 'BU', major: 'CS', degree: '本科', start: '2020-09', end: '2024-06' }],
  experiences: [{ company: 'BC', title: 'Eng', start: '2024-07', end: '至今', desc: 'x' }],
  expected: { city: 'Bench City', position: 'Eng', salary_min: 10000, salary_max: 20000 },
  skills: ['javascript'],
};

async function createJob(port, adminAuth) {
  const r = await fetchJson(`http://127.0.0.1:${port}/api/admin/jobs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${adminAuth.token}`,
      'x-csrf-token': adminAuth.csrfToken, // adminAuth runs requireCsrf on mutating
    },
    body: JSON.stringify({
      title: 'Bench Job', company: 'Bench Co', city: 'Bench City',
      salary_min: 10000, salary_max: 20000,
      degree_required: '不限', experience_required: '不限',
      skills_required: ['javascript'], description_md: '# bench job',
    }),
  });
  if (r.status !== 200 || r.body?.code !== 0) {
    throw new Error(`createJob failed: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  }
  return r.body.data.job_id;
}

async function saveResume(port, userJwt) {
  const r = await fetchJson(`http://127.0.0.1:${port}/api/resume/save`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${userJwt}` },
    body: JSON.stringify({ source_form: RESUME_FIXTURE }),
  });
  if (r.status !== 200 || r.body?.code !== 0) {
    throw new Error(`saveResume failed: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  }
  return r.body.data.resume_id;
}

async function main() {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  logger.info({ port }, 'bench app listening');

  let exitCode = 0;
  try {
    await clearRateLimits();
    await seed();

    const adminAuth = await login(port, 'bench-admin-code');
    const userAuth = await login(port, 'bench-user-code');
    const jobId = await createJob(port, adminAuth);
    const resumeId = await saveResume(port, userAuth.token);

    const base = `http://127.0.0.1:${port}`;
    const userHdr = { 'content-type': 'application/json', authorization: `Bearer ${userAuth.token}` };

    const targets = [
      { name: 'GET /api/health', url: `${base}/api/health`, method: 'GET', connections: 50, headers: {}, body: undefined },
      { name: 'POST /api/resume/save', url: `${base}/api/resume/save`, method: 'POST', connections: 20, headers: userHdr, body: JSON.stringify({ source_form: RESUME_FIXTURE }) },
      { name: 'POST /api/resume/generate', url: `${base}/api/resume/generate`, method: 'POST', connections: 5, headers: userHdr, body: JSON.stringify({ resume_id: resumeId }) },
      { name: 'POST /api/match', url: `${base}/api/match`, method: 'POST', connections: 5, headers: userHdr, body: JSON.stringify({ resume_id: resumeId }) },
    ];

    const results = [];
    for (const t of targets) {
      logger.info({ endpoint: t.name, conn: t.connections }, 'starting');
      const s = summary(t.name, await runOne(t));
      results.push(s);
      console.log(JSON.stringify(s));
      if (s.latency.p99 > P99_MS) {
        logger.warn({ endpoint: t.name, p99: s.latency.p99, threshold: P99_MS }, 'p99 over threshold');
        exitCode = 1;
      }
    }

    console.log('\n=== PERF BENCH REPORT ===\n' + JSON.stringify({
      threshold_p99_ms: P99_MS, duration_per_endpoint_s: DURATION,
      job_id: jobId, resume_id: resumeId, endpoints: results,
    }, null, 2));
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'bench failed');
    exitCode = 1;
  } finally {
    try { server.close(); } catch {}
    try { await pool.end(); } catch {}
    try { await redis.quit(); } catch {}
  }
  process.exit(exitCode);
}

process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

main();