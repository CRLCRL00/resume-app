/**
 * perf-bench.js — p95/p99 latency + throughput baseline for 4 hot endpoints.
 *
 * Modes:
 *   mock  (default) — llm.chat / llm.chatJson stubbed; fast offline baseline.
 *   real  (BENCH_REAL_LLM=1 or --real-llm) — actual DeepSeek calls.
 *
 * Usage:
 *   npm run perf:bench              # mock, 10s per endpoint, p99=2000ms
 *   npm run perf:bench:ci           # mock, 5s per endpoint, p99=1500ms, p95=800ms
 *   npm run perf:bench:real         # real LLM, 30s per endpoint @ 2 conn
 *   BENCH_P99_MS=1500 BENCH_P95_MS=800 node scripts/perf-bench.js
 *
 * Boots createApp() on 127.0.0.1:0, drives autocannon sequentially, emits
 * JSON per endpoint + a final PERF BENCH REPORT. Exit 1 if any p99 over
 * BENCH_P99_MS, any p95 over BENCH_P95_MS, or any endpoint has errors > 0.
 * Emits a final `RESULT: ok|fail` line for CI parsing. CI mode (CI=true)
 * suppresses ANSI color codes. Rate-limit middleware bypassed via
 * require.cache injection so we measure route+DB+LLM latency, not 429
 * saturation.
 *
 * Programmatic API (for tests):
 *   const { runBench, main } = require('./scripts/perf-bench');
 *   const out = await runBench({ realLlm: true, duration: 30, llmConcurrency: 2 });
 *   const code = await main({ runBench: async () => syntheticResult });
 */
const path = require('node:path');

// ────────────── mode detection ──────────────
function parseCliMode(argv) {
  // --real-llm beats env (explicit > implicit)
  if (Array.isArray(argv) && argv.includes('--real-llm')) return 'real';
  if (process.env.BENCH_REAL_LLM === '1') return 'real';
  return 'mock';
}
const CLI_MODE = parseCliMode(process.argv.slice(2));

// JSON output mode: --json flag or BENCH_JSON_OUTPUT=1. Suppresses human
// table; prints ONLY the JSON array of endpoint results to stdout. Used by
// .github/workflows/perf-ci.yml to feed perf-comment.js + the artifact.
const JSON_OUTPUT = process.env.BENCH_JSON_OUTPUT === '1'
  || (Array.isArray(process.argv.slice(2)) && process.argv.slice(2).includes('--json'));
// Output file for the JSON array. Default: backend/.bench-results.json.
// Set BENCH_OUTPUT_FILE to override (e.g. CI may use a different path).
const JSON_OUTPUT_FILE = process.env.BENCH_OUTPUT_FILE
  || path.join(__dirname, '..', '.bench-results.json');

// 1. Mock externals BEFORE app boots (require.cache injection).
// CLI mode (node scripts/perf-bench.js) → mock wechat + llm so bench is offline.
// Programmatic callers (tests) call runBench() with realLlm:true to skip mockLlm.
// mockWechat is always required so bench-admin-code → bench-admin openid.
const { mockWechat, mockLlm } = require('../tests/e2e/helpers/mocks');
mockWechat({ 'bench-admin-code': 'bench-admin', 'bench-user-code': 'bench-user' });
if (CLI_MODE !== 'real') {
  mockLlm('# bench mock resume\n## section');
}

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

// 3. Load app + config (db/redis lazy-loaded inside runBench so each
// invocation gets a fresh pool — required when realLlm mode evicts
// src/app and the cached pool may already be closed by a prior runBench).
require('dotenv').config({ path: path.join(backendRoot, '.env') });
const autocannon = require('autocannon');
const logger = require('../src/utils/logger');
// CI mode: suppress ANSI color codes so log lines are grep-friendly.
if (process.env.CI === 'true') {
  process.env.FORCE_COLOR = '0';
  process.env.NO_COLOR = '1';
  if (process.stdout && typeof process.stdout.isTTY !== 'undefined') {
    process.stdout.isTTY = false;
  }
  if (process.stderr && typeof process.stderr.isTTY !== 'undefined') {
    process.stderr.isTTY = false;
  }
}
if (CLI_MODE === 'real') {
  logger.warn('CLI real-LLM mode: DeepSeek calls enabled. Tokens will be billed.');
}

// ────────────── token capture ──────────────
// Wraps axios.post to capture DeepSeek `usage` from response.data. This
// works regardless of whether llm.js / resumeGenerator / route handlers are
// re-required after realLlm eviction (those modules close over their
// `require('axios')` reference, not over llm.chat — wrapping axios.post
// intercepts every upstream call).
function captureLlmUsage() {
  const axios = require('axios');
  const totals = { prompt: 0, completion: 0, total: 0, calls: 0 };
  const origPost = axios.post;
  axios.post = async (url, body, config) => {
    const res = await origPost.call(axios, url, body, config);
    const usage = res && res.data && res.data.usage;
    console.log('[capture wrap] usage=', usage, 'typeof total=', typeof (usage && usage.total_tokens));
    if (usage && typeof usage.total_tokens === 'number') {
      totals.prompt += usage.prompt_tokens || 0;
      totals.completion += usage.completion_tokens || 0;
      totals.total += usage.total_tokens;
      totals.calls += 1;
    }
    return res;
  };

  return {
    snapshot() {
      if (totals.calls === 0) return null;
      return {
        prompt: totals.prompt,
        completion: totals.completion,
        total: totals.total,
        per_call: {
          prompt: Math.round(totals.prompt / totals.calls),
          completion: Math.round(totals.completion / totals.calls),
          total: Math.round(totals.total / totals.calls),
        },
        calls: totals.calls,
      };
    },
    restore() {
      axios.post = origPost;
    },
  };
}

// ────────────── bench helpers ──────────────
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
    duration_s: result.duration || 0, samples: result.requests?.sent,
  };
}

// Tag an endpoint entry with `result: 'ok'|'fail'`. Uses thresholds captured
// at bench time (p99Ms/p95Ms). Fail if p99>=p99Ms OR p95>=p95Ms OR errors>0.
function tagResult(entry, p99Ms, p95Ms) {
  const p99 = entry.latency?.p99 || 0;
  const p95 = entry.latency?.p95 || 0;
  const errors = entry.errors || 0;
  entry.result = (p99 < p99Ms && p95 < p95Ms && errors === 0) ? 'ok' : 'fail';
  return entry;
}

function runOne(target, duration) {
  return new Promise((resolve, reject) => {
    const inst = autocannon({
      url: target.url, method: target.method, headers: target.headers || {},
      body: target.body, connections: target.connections, duration, pipelining: 1,
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
  return r.body.data;
}

async function seed(pool) {
  await pool.query('INSERT IGNORE INTO users (openid, nickname) VALUES (?, ?)', ['bench-admin', 'Bench Admin']);
  await pool.query('INSERT IGNORE INTO users (openid, nickname) VALUES (?, ?)', ['bench-user', 'Bench User']);
  await pool.query('INSERT IGNORE INTO admins (openid, note) VALUES (?, ?)', ['bench-admin', 'bench']);
}

async function clearRateLimits(redis) {
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
      'x-csrf-token': adminAuth.csrfToken,
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

/**
 * Programmatic bench. Returns:
 *   { mode, threshold_p99_ms, threshold_p95_ms, duration_per_endpoint_s, job_id, resume_id, endpoints }
 *
 * endpoints[i].tokens_per_call = null for non-LLM endpoints, else
 * {prompt, completion, total, calls} aggregated for that endpoint.
 *
 * @param {Object}  [opts]
 * @param {boolean} [opts.realLlm]            - skip mockLlm; hit DeepSeek (default false)
 * @param {number}  [opts.duration]           - seconds per endpoint (10 mock / 30 real)
 * @param {number}  [opts.llmConcurrency]     - connections for LLM endpoints (5 / 2)
 * @param {number}  [opts.nonLlmConcurrency]  - connections for non-LLM endpoints (50 / 10)
 * @param {boolean} [opts.skipNonLlm]         - bench only LLM endpoints (real-mode convenience)
 * @param {number}  [opts.p99Ms]              - p99 threshold; informational only here
 * @param {number}  [opts.p95Ms]              - p95 threshold; informational only here
 * @param {boolean} [opts.printJson]          - console.log each endpoint JSON (default true)
 * @param {boolean} [opts.skipTeardown]       - skip pool.end()/redis.quit() in finally
 */
async function runBench(opts = {}) {
  const realLlm = Boolean(opts.realLlm);
  const mode = realLlm ? 'real' : 'mock';
  const duration = opts.duration || (realLlm ? 30 : 10);
  const llmConn = opts.llmConcurrency || (realLlm ? 2 : 5);
  const nonLlmConn = opts.nonLlmConcurrency || (realLlm ? 10 : 50);
  const skipNonLlm = Boolean(opts.skipNonLlm);
  const printJson = opts.printJson !== false;
  // Thresholds captured at bench time; used to tag each entry.result. When
  // JSON output mode is on we still need this even though main() is also
  // computing the gate decision.
  const tagP99 = opts.p99Ms || Number(process.env.BENCH_P99_MS) || 2000;
  const tagP95 = opts.p95Ms || Number(process.env.BENCH_P95_MS) || 800;

  if (realLlm) {
    const evict = [
      path.join(backendRoot, 'src/services/llm'),
      path.join(backendRoot, 'src/services/resumeGenerator'),
      path.join(backendRoot, 'src/services/resumePrompt'),
      path.join(backendRoot, 'src/services/matchService'),
      path.join(backendRoot, 'src/services/matchPrompt'),
      path.join(backendRoot, 'src/routes/resume'),
      path.join(backendRoot, 'src/routes/match'),
      path.join(backendRoot, 'src/routes/admin'),
      path.join(backendRoot, 'src/routes/jobs'),
      path.join(backendRoot, 'src/routes/user'),
      path.join(backendRoot, 'src/routes/auth'),
      path.join(backendRoot, 'src/routes/health'),
      path.join(backendRoot, 'src/app'),
    ];
    for (const p of evict) {
      try { delete require.cache[require.resolve(p)]; } catch {}
    }
    const freshLlm = require(path.join(backendRoot, 'src/services/llm'));
    const freshMatchSvc = require(path.join(backendRoot, 'src/services/matchService'));
    const freshResumeGen = require(path.join(backendRoot, 'src/services/resumeGenerator'));
    logger.warn({
      evictedCount: evict.length,
      llmChatSrc: freshLlm.chat.toString().slice(0, 80),
      matchServiceLlmChatSrc: freshMatchSvc.llm && freshMatchSvc.llm.chat.toString().slice(0, 80),
      resumeGenLlmChatSrc: freshResumeGen.llm && freshResumeGen.llm.chat.toString().slice(0, 80),
    }, 'BENCH REAL-LLM mode: DeepSeek calls enabled.');
  }

  // Lazy require so we always pick up the freshly-re-required app module
// (after realLlm eviction). The destructure inside createApp captures the
// module-level `resumeRouter` from app.js — re-requiring app.js binds a new
// variable, but our previously destructured `createApp` would still hold
// the old closure. So we ALWAYS re-require here, after the evict block.
  const { createApp } = require('../src/app');
  const app = createApp();
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  logger.info({ port, mode }, 'bench app listening');

  // Lazy require so the cached pool/redis from a prior runBench (or from
  // realLlm mode's app eviction) is bypassed.
  const pool = require('../src/config/db');
  const redis = require('../src/config/redis');

  const tokenCapture = captureLlmUsage();

  let result;
  try {
    await clearRateLimits(redis);
    await seed(pool);
    const adminAuth = await login(port, 'bench-admin-code');
    const userAuth = await login(port, 'bench-user-code');
    const jobId = await createJob(port, adminAuth);
    const resumeId = await saveResume(port, userAuth.token);

    const base = `http://127.0.0.1:${port}`;
    const userHdr = { 'content-type': 'application/json', authorization: `Bearer ${userAuth.token}` };

    const allTargets = [
      { name: 'GET /api/health', url: `${base}/api/health`, method: 'GET', connections: nonLlmConn, headers: {}, body: undefined, llm: false },
      { name: 'POST /api/resume/save', url: `${base}/api/resume/save`, method: 'POST', connections: nonLlmConn, headers: userHdr, body: JSON.stringify({ source_form: RESUME_FIXTURE }), llm: false },
      { name: 'POST /api/resume/generate', url: `${base}/api/resume/generate`, method: 'POST', connections: llmConn, headers: userHdr, body: JSON.stringify({ resume_id: resumeId }), llm: true },
      { name: 'POST /api/match', url: `${base}/api/match`, method: 'POST', connections: llmConn, headers: userHdr, body: JSON.stringify({ resume_id: resumeId }), llm: true },
    ];
    const targets = skipNonLlm ? allTargets.filter((t) => t.llm) : allTargets;

    // Capture per-endpoint token diff: snapshot before each LLM endpoint,
    // diff after. Non-LLM endpoints get null (no DeepSeek traffic).
    const endpointResults = [];
    let llmBefore = tokenCapture.snapshot() || { calls: 0, prompt: 0, completion: 0, total: 0 };
    for (const t of targets) {
      logger.info({ endpoint: t.name, conn: t.connections, mode }, 'starting');
      if (t.llm) llmBefore = tokenCapture.snapshot() || llmBefore;
      const s = summary(t.name, await runOne(t, duration));

      if (t.llm) {
        const after = tokenCapture.snapshot();
        if (after && llmBefore) {
          // Use absolute diffs of totals (prompt/completion/total/calls),
          // not per_call ratios — per_call would always be ~850 across
          // snapshots since DeepSeek returns identical usage, masking real
          // accumulation. The deltas give accurate "this endpoint added
          // N prompt tokens over K calls".
          s.tokens_per_call = {
            prompt: after.prompt - llmBefore.prompt,
            completion: after.completion - llmBefore.completion,
            total: after.total - llmBefore.total,
            calls: after.calls - llmBefore.calls,
          };
          s.tokens_per_call.per_call = s.tokens_per_call.calls > 0 ? {
            prompt: Math.round(s.tokens_per_call.prompt / s.tokens_per_call.calls),
            completion: Math.round(s.tokens_per_call.completion / s.tokens_per_call.calls),
            total: Math.round(s.tokens_per_call.total / s.tokens_per_call.calls),
          } : null;
        } else {
          s.tokens_per_call = null;
        }
      } else {
        s.tokens_per_call = null;
      }
      endpointResults.push(s);
      tagResult(s, tagP99, tagP95);
      if (printJson) console.log(JSON.stringify(s));
    }

    result = {
      mode,
      threshold_p99_ms: opts.p99Ms || Number(process.env.BENCH_P99_MS) || 2000,
      threshold_p95_ms: opts.p95Ms || Number(process.env.BENCH_P95_MS) || 800,
      duration_per_endpoint_s: duration,
      job_id: jobId,
      resume_id: resumeId,
      endpoints: endpointResults,
    };

    if (printJson) {
      console.log('\n=== PERF BENCH REPORT ===\n' + JSON.stringify(result, null, 2));
    }
  } finally {
    tokenCapture.restore();
    try { server.close(); } catch {}
    // Skip pool/redis teardown when caller manages lifecycle (tests).
    // CLI main() calls process.exit() so it doesn't matter; tests reuse
    // the pool across multiple runBench() invocations.
    if (!opts.skipTeardown) {
      try { await pool.end(); } catch {}
      try { await redis.quit(); } catch {}
    }
  }
  return result;
}

function printComparisonTable(result) {
  const lines = [];
  lines.push('Endpoint                    | p99 (ms) | Tokens/call (prompt/completion/total, calls)');
  lines.push('----------------------------|----------|-------------------------------------------------');
  for (const e of result.endpoints) {
    const name = e.endpoint.padEnd(27);
    const p99 = String(e.latency.p99).padStart(8);
    const t = e.tokens_per_call
      ? `${e.tokens_per_call.prompt} / ${e.tokens_per_call.completion} / ${e.tokens_per_call.total} (${e.tokens_per_call.calls})`
      : '(no LLM)';
    lines.push(`${name} | ${p99} | ${t}`);
  }
  console.log('\n=== PERF BENCH COMPARISON (mode=' + result.mode + ') ===');
  console.log(lines.join('\n'));
}

async function main(opts = {}) {
  const p99Ms = opts.p99Ms ?? (Number(process.env.BENCH_P99_MS) || 2000);
  const p95Ms = opts.p95Ms ?? (Number(process.env.BENCH_P95_MS) || 800);
  // Allow tests to inject a fake runBench via module.exports.runBench —
  // we resolve the runner through `exports` (not the closure-local `runBench`)
  // so swapping the export before calling main() actually takes effect.
  const exportsRef = module.exports;
  const runner = opts.runBench || exportsRef.runBench || runBench;
  // JSON output mode: --json or BENCH_JSON_OUTPUT=1. In this mode main()
  // suppresses per-endpoint JSON lines, the comparison table, and the
  // perf bench report block; only the final array goes to stdout (or the
  // configured file). The structured `RESULT: ok|fail` line still emits.
  const jsonMode = JSON_OUTPUT || Boolean(opts.jsonOutput);
  let exitCode = 0;
  const failures = [];
  let endpointResults = [];
  try {
    const result = await runner({
      realLlm: CLI_MODE === 'real',
      duration: Number(process.env.BENCH_DURATION) || undefined,
      p99Ms,
      p95Ms,
      // Suppress per-endpoint JSON line + report block when we want a
      // clean array on stdout. Tests can still override via opts.printJson.
      printJson: jsonMode ? false : undefined,
    });
    endpointResults = result.endpoints || [];
    for (const e of endpointResults) {
      if (e.latency.p99 > p99Ms) {
        logger.warn({ endpoint: e.endpoint, p99: e.latency.p99, threshold: p99Ms }, 'p99 over threshold');
        failures.push({ endpoint: e.endpoint, kind: 'p99', value: e.latency.p99, threshold: p99Ms });
        exitCode = 1;
      }
      if (e.latency.p95 > p95Ms) {
        logger.warn({ endpoint: e.endpoint, p95: e.latency.p95, threshold: p95Ms }, 'p95 over threshold');
        failures.push({ endpoint: e.endpoint, kind: 'p95', value: e.latency.p95, threshold: p95Ms });
        exitCode = 1;
      }
      if ((e.errors || 0) > 0) {
        logger.warn({ endpoint: e.endpoint, errors: e.errors }, 'errors detected');
        failures.push({ endpoint: e.endpoint, kind: 'errors', value: e.errors, threshold: 0 });
        exitCode = 1;
      }
    }
    if (CLI_MODE === 'real') {
      const total = endpointResults
        .filter((e) => e.tokens_per_call)
        .reduce((acc, e) => acc + (e.tokens_per_call.total || 0), 0);
      logger.info({ totalTokens: total }, 'real-LLM bench token usage');
    }
    if (jsonMode) {
      // Emit ONLY the array (CI parses with `node -e` or jq-like consumer).
      // Human-readable summary goes to stderr so CI log reviewers still see
      // p95/p99 at a glance; the markdown PR comment has the same data
      // rendered as a table.
      const arrayJson = JSON.stringify(endpointResults);
      process.stdout.write(arrayJson + '\n');
      try {
        require('node:fs').writeFileSync(JSON_OUTPUT_FILE, arrayJson);
        logger.info({ file: JSON_OUTPUT_FILE, count: endpointResults.length }, 'bench results saved');
      } catch (e) {
        logger.error({ err: e.message, file: JSON_OUTPUT_FILE }, 'failed to write bench results file');
      }
      // Render a compact table to stderr (pino goes to stdout, so use stderr
      // directly to avoid clobbering the array consumers parse).
      const cols = [
        ['Endpoint', 30], ['p50', 6], ['p95', 6], ['p99', 6],
        ['RPS', 8], ['Err', 5], ['Result', 7],
      ];
      const header = cols.map(([n, w]) => n.padEnd(w)).join(' | ');
      const sep = cols.map(([, w]) => '-'.repeat(w)).join('-+-');
      process.stderr.write('\n=== PERF BENCH (JSON mode) ===\n' + header + '\n' + sep + '\n');
      for (const e of endpointResults) {
        const row = [
          e.endpoint.padEnd(30),
          String(e.latency.p50).padStart(6),
          String(e.latency.p95).padStart(6),
          String(e.latency.p99).padStart(6),
          String(Math.round(e.throughput?.avg || 0)).padStart(8),
          String(e.errors || 0).padStart(5),
          (e.result || '').padEnd(7),
        ].join(' | ');
        process.stderr.write(row + '\n');
      }
      process.stderr.write('\n');
    } else {
      printComparisonTable(result);
    }
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'bench failed');
    failures.push({ endpoint: 'bench', kind: 'crash', value: err.message, threshold: 0 });
    exitCode = 1;
  }
  // Emit structured final line for CI grep / artifact parsing.
  // Plain text on its own line — no ANSI, no JSON. Format intentionally
  // stable: callers should be able to `grep -E '^RESULT:' perf-output.txt`.
  const status = exitCode === 0 ? 'ok' : 'fail';
  console.log(`RESULT: ${status}` + (failures.length ? ` (failures=${JSON.stringify(failures)})` : ''));
  return exitCode;
}

process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

module.exports = { runBench, main, printComparisonTable };

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    logger.error({ err: err.message, stack: err.stack }, 'bench main failed');
    process.exit(1);
  });
}