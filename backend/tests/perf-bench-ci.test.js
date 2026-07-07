// Tests for perf-bench CI-mode thresholds + structured RESULT line.
//
// Validates main():
//   1. exits 1 when p99 > BENCH_P99_MS
//   2. exits 1 when p95 > BENCH_P95_MS
//   3. exits 1 when any endpoint has errors > 0
//   4. exits 0 when everything is within thresholds + 0 errors
//   5. suppresses ANSI color codes when CI=true
//
// runBench is stubbed in-process (no spawn, no DB). We require perf-bench
// AFTER the stubs land so the script's top-level mocks don't double-init.

const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const backendRoot = path.join(__dirname, '..');

// Same module stubs as perf-bench-real.test.js so the script's top-level
// code (mockWechat, rate-limit bypass, dotenv config) doesn't blow up
// without a real DB/Redis. These must be applied BEFORE requiring the
// script, otherwise the script's `require.cache[require.resolve(...)]`
// writes will overwrite our stubs.
function stubModule(absPath, exports) {
  require.cache[require.resolve(absPath)] = {
    id: absPath, filename: absPath, loaded: true, exports, paths: [],
  };
}

const noopMw = (req, res, next) => next();
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

// Reset prom-client registry in case other test files have polluted it.
// perf-bench itself doesn't register metrics, but mockWechat chain-loads
// the request lib which may indirectly require metrics.js.
const promClient = require('prom-client');
try { promClient.register.clear(); } catch {}

// Force CI mode for the whole file.
const origCI = process.env.CI;
process.env.CI = 'true';

// Mock wechat BEFORE perf-bench loads.
const { mockWechat } = require('./e2e/helpers/mocks');
mockWechat({ 'bench-admin-code': 'bench-admin', 'bench-user-code': 'bench-user' });

// Now load the script — its top-level mocks + module-scope runBench export
// get cached. We swap runBench in each test below.
const perfBench = require('../scripts/perf-bench');

function makeResult({ p99, p95, errors }) {
  return {
    mode: 'mock',
    threshold_p99_ms: Number(process.env.BENCH_P99_MS) || 2000,
    threshold_p95_ms: Number(process.env.BENCH_P95_MS) || 800,
    duration_per_endpoint_s: 1,
    job_id: 1, resume_id: 1,
    endpoints: [
      { endpoint: 'GET /api/health', latency: { p50: 1, p95, p99, max: p99 }, throughput: { avg: 1, min: 1, max: 1 }, errors, non2xx: 0, '2xx': 100, duration_s: 1, samples: 100, tokens_per_call: null },
    ],
  };
}

after(() => {
  if (origCI === undefined) delete process.env.CI;
  else process.env.CI = origCI;
});

test('CI mode: main() returns 1 when p99 > BENCH_P99_MS', async () => {
  const origP99 = process.env.BENCH_P99_MS;
  const origP95 = process.env.BENCH_P95_MS;
  process.env.BENCH_P99_MS = '500';
  process.env.BENCH_P95_MS = '5000';
  try {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    const code = await perfBench.main({ runBench: async () => makeResult({ p99: 2000, p95: 100, errors: 0 }) });
    console.log = origLog;
    const all = logs.join('\n');
    assert.equal(code, 1, `main() should return 1 on p99 breach`);
    assert.match(all, /RESULT: fail/, `must emit RESULT: fail, got: ${all}`);
  } finally {
    if (origP99 === undefined) delete process.env.BENCH_P99_MS;
    else process.env.BENCH_P99_MS = origP99;
    if (origP95 === undefined) delete process.env.BENCH_P95_MS;
    else process.env.BENCH_P95_MS = origP95;
  }
});

test('CI mode: main() returns 1 when p95 > BENCH_P95_MS', async () => {
  const origP99 = process.env.BENCH_P99_MS;
  const origP95 = process.env.BENCH_P95_MS;
  process.env.BENCH_P99_MS = '5000';
  process.env.BENCH_P95_MS = '500';
  try {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    const code = await perfBench.main({ runBench: async () => makeResult({ p99: 300, p95: 2000, errors: 0 }) });
    console.log = origLog;
    const all = logs.join('\n');
    assert.equal(code, 1, `main() should return 1 on p95 breach`);
    assert.match(all, /RESULT: fail/, `must emit RESULT: fail, got: ${all}`);
  } finally {
    if (origP99 === undefined) delete process.env.BENCH_P99_MS;
    else process.env.BENCH_P99_MS = origP99;
    if (origP95 === undefined) delete process.env.BENCH_P95_MS;
    else process.env.BENCH_P95_MS = origP95;
  }
});

test('CI mode: main() returns 1 when any endpoint has errors > 0', async () => {
  const origP99 = process.env.BENCH_P99_MS;
  const origP95 = process.env.BENCH_P95_MS;
  process.env.BENCH_P99_MS = '5000';
  process.env.BENCH_P95_MS = '5000';
  try {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    const code = await perfBench.main({ runBench: async () => makeResult({ p99: 200, p95: 100, errors: 3 }) });
    console.log = origLog;
    const all = logs.join('\n');
    assert.equal(code, 1, `main() should return 1 on errors > 0`);
    assert.match(all, /RESULT: fail/, `must emit RESULT: fail, got: ${all}`);
  } finally {
    if (origP99 === undefined) delete process.env.BENCH_P99_MS;
    else process.env.BENCH_P99_MS = origP99;
    if (origP95 === undefined) delete process.env.BENCH_P95_MS;
    else process.env.BENCH_P95_MS = origP95;
  }
});

test('CI mode: main() returns 0 when all endpoints within thresholds + 0 errors', async () => {
  const origP99 = process.env.BENCH_P99_MS;
  const origP95 = process.env.BENCH_P95_MS;
  process.env.BENCH_P99_MS = '2000';
  process.env.BENCH_P95_MS = '800';
  try {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    const code = await perfBench.main({ runBench: async () => makeResult({ p99: 200, p95: 100, errors: 0 }) });
    console.log = origLog;
    const all = logs.join('\n');
    assert.equal(code, 0, `main() should return 0 when within thresholds`);
    assert.match(all, /RESULT: ok/, `must emit RESULT: ok, got: ${all}`);
  } finally {
    if (origP99 === undefined) delete process.env.BENCH_P99_MS;
    else process.env.BENCH_P99_MS = origP99;
    if (origP95 === undefined) delete process.env.BENCH_P95_MS;
    else process.env.BENCH_P95_MS = origP95;
  }
});

test('CI mode: suppresses ANSI color codes when CI=true', async () => {
  // Script's top-level already set NO_COLOR=1 and FORCE_COLOR=0 when we
  // loaded it with CI=true. Verify by running main() and inspecting all
  // console.log output for ANSI escape sequences.
  const origP99 = process.env.BENCH_P99_MS;
  const origP95 = process.env.BENCH_P95_MS;
  process.env.BENCH_P99_MS = '5000';
  process.env.BENCH_P95_MS = '5000';
  try {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    const code = await perfBench.main({ runBench: async () => makeResult({ p99: 200, p95: 100, errors: 0 }) });
    console.log = origLog;
    const all = logs.join('\n');
    assert.equal(code, 0, `main() should return 0`);
    assert.doesNotMatch(all, /\x1b\[/, `CI mode must suppress ANSI escapes, got: ${all.slice(0, 300)}`);
  } finally {
    if (origP99 === undefined) delete process.env.BENCH_P99_MS;
    else process.env.BENCH_P99_MS = origP99;
    if (origP95 === undefined) delete process.env.BENCH_P95_MS;
    else process.env.BENCH_P95_MS = origP95;
  }
});