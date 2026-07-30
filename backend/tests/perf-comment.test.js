// Tests for scripts/perf-comment.js — PR markdown table generator.
//
// Verifies the 4 required behaviors:
//   1. Generates markdown table from sample JSON
//   2. Fail result shows ❌
//   3. Empty results array → "No benchmark data"
//   4. Thresholds displayed correctly
//
// perf-comment.js is a pure script that reads JSON + writes markdown to
// stdout. We invoke it via require() and capture console.log output.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const backendRoot = path.join(__dirname, '..');
const scriptPath = path.join(backendRoot, 'scripts/perf-comment.js');
const tmpDir = path.join(backendRoot, '.tmp-perf-comment-test');

function makeSampleResults() {
  return [
    {
      endpoint: 'GET /api/health',
      latency: { p50: 23, p95: 33, p99: 36, max: 58 },
      throughput: { avg: 2114.6 },
      errors: 0, non2xx: 0,
      duration_s: 10, samples: 21194,
      result: 'ok',
    },
    {
      endpoint: 'POST /api/resume/save',
      latency: { p50: 207, p95: 275, p99: 279, max: 290 },
      throughput: { avg: 96 },
      errors: 0, non2xx: 0,
      duration_s: 10, samples: 962,
      result: 'ok',
    },
  ];
}

function captureLog(fn) {
  const logs = [];
  const orig = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  return Promise.resolve(fn()).finally(() => {
    console.log = orig;
  }).then(() => logs.join('\n'));
}

function runScriptWith(jsonObj, sha = 'abc1234') {
  // Write JSON to a temp file, then exec the script with the path as argv[2].
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const file = path.join(tmpDir, `bench-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(jsonObj));
  // Clear require cache so script reads fresh file each time.
  delete require.cache[scriptPath];
  const shaBefore = process.env.GITHUB_SHA;
  process.env.GITHUB_SHA = sha;
  return captureLog(() => require(scriptPath)(file)).finally(() => {
    if (shaBefore === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = shaBefore;
    try { fs.unlinkSync(file); } catch {}
  });
}

before(() => {
  // Ensure tmp dir exists, clean any stragglers
  if (fs.existsSync(tmpDir)) {
    for (const f of fs.readdirSync(tmpDir)) {
      try { fs.unlinkSync(path.join(tmpDir, f)); } catch {}
    }
  }
});

after(() => {
  try {
    for (const f of fs.readdirSync(tmpDir)) {
      try { fs.unlinkSync(path.join(tmpDir, f)); } catch {}
    }
    fs.rmdirSync(tmpDir);
  } catch {}
});

test('perf-comment: generates markdown table from sample JSON', async () => {
  const out = await runScriptWith(makeSampleResults(), 'deadbee');
  assert.match(out, /^## Perf Bench \(commit deadbee\)/m, 'must include header with SHA');
  assert.match(out, /\| Endpoint \| p50 \(ms\) \| p95 \(ms\) \| p99 \(ms\) \| RPS \| Err \| Result \|/);
  assert.match(out, /\| GET \/api\/health \| 23 \| 33 \| 36 \| 2115 \| 0 \| ✅ \|/);
  assert.match(out, /\| POST \/api\/resume\/save \| 207 \| 275 \| 279 \| 96 \| 0 \| ✅ \|/);
});

test('perf-comment: fail result shows ❌', async () => {
  const data = [{
    endpoint: 'POST /api/match',
    latency: { p50: 100, p95: 900, p99: 1800, max: 2000 },
    throughput: { avg: 50 },
    errors: 5, non2xx: 5,
    duration_s: 10, samples: 500,
    result: 'fail',
  }];
  const out = await runScriptWith(data, 'cafe000');
  assert.match(out, /\| POST \/api\/match \| 100 \| 900 \| 1800 \| 50 \| 5 \| ❌ \|/);
});

test('perf-comment: empty results array → "No benchmark data"', async () => {
  const out = await runScriptWith([], 'empty00');
  assert.match(out, /## Perf Bench \(commit empty00\)/);
  assert.match(out, /No benchmark data/);
});

test('perf-comment: thresholds displayed correctly', async () => {
  // Default p95=800, p99=1500 (matches perf-ci.yml).
  const out = await runScriptWith(makeSampleResults(), 'thresh0');
  assert.match(out, /Thresholds: p95 < 800ms, p99 < 1500ms/);
});
