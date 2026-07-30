// Tests for perf-bench real-LLM mode.
//
// Mocks globalThis.fetch so axios-based real-LLM path can be intercepted
// without hitting DeepSeek. Validates runBench({realLlm:true}) returns a
// comparison-shaped result with token usage captured.
//
// Mock-mode bench is exercised by the CLI smoke `node scripts/perf-bench.js`
// in docs/perf-bench.md (would conflict with this test's require.cache mutations).

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const backendRoot = path.join(__dirname, '..');

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

// Force llm.js's axios.post to delegate to globalThis.fetch so the test
// can intercept DeepSeek calls without bringing in undici mocks. We mutate
// axios.post in-place; llm.js already destructures axios at require time,
// so this works even though we never re-require llm.
const axios = require('axios');
const origAxiosPost = axios.post;
let axiosPostCalls = 0;
axios.post = async (url, body, config) => {
  axiosPostCalls += 1;
  console.log('[axios.post] called url=', url);
  const r = await globalThis.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(config && config.headers) },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  return { data };
};

// Reset prom-client singleton registry before each test. perf-bench evicts
// src/app from require.cache to pick up the real llm module — that re-requires
// src/routes/metrics which re-registers all metric instances and double-
// registration throws. Clearing the registry makes the re-registration safe.
const promClient = require('prom-client');
// Pre-emptively clear so that perf-bench's evict + re-require works.
// Without this, the second require of metrics.js throws "metric already
// registered" because prom-client registry is a process-wide singleton.
try { promClient.register.clear(); } catch {}

after(async () => {
  axios.post = origAxiosPost;
  // Best-effort pool teardown for the whole test file.
  try {
    const pool = require('../src/config/db');
    await pool.end();
  } catch {}
  try {
    const redis = require('../src/config/redis');
    await redis.quit();
  } catch {}
});

// Mock wechat BEFORE perf-bench loads.
const { mockWechat } = require('./e2e/helpers/mocks');
mockWechat({ 'bench-admin-code': 'bench-admin', 'bench-user-code': 'bench-user' });

const { runBench } = require('../scripts/perf-bench');

function makeFakeDeepSeekResponse(content) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 850, completion_tokens: 220, total_tokens: 1070 },
  };
}

test('runBench real-LLM mode returns comparison with mock + real rows', async () => {
  const origFetch = globalThis.fetch;
  let llmCalls = 0;
  globalThis.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('/chat/completions')) {
      llmCalls += 1;
      const body = JSON.stringify(makeFakeDeepSeekResponse('mocked deepseek content'));
      return {
        ok: true, status: 200,
        json: async () => JSON.parse(body),
        text: async () => body,
      };
    }
    return origFetch(url, opts);
  };

  try {
    const t0 = Date.now();
    promClient.register.clear();  // see comment above
    const result = await runBench({
      realLlm: true,
      duration: 1,         // 1s per endpoint — keeps test < 5s
      llmConcurrency: 2,
      skipTeardown: true,
    });
    const elapsed = Date.now() - t0;

    assert.ok(elapsed < 5000, `bench took ${elapsed}ms, must be < 5000ms`);
    assert.equal(result.mode, 'real');
    assert.ok(Array.isArray(result.endpoints), 'endpoints must be array');
    assert.ok(result.endpoints.length >= 4, 'must bench all 4 endpoints');

    const byName = Object.fromEntries(result.endpoints.map((e) => [e.endpoint, e]));
    assert.ok(byName['GET /api/health'], 'health present');
    assert.ok(byName['POST /api/resume/generate'], 'generate present');
    assert.ok(byName['POST /api/match'], 'match present');

    // LLM endpoints must have token usage captured (mock fetch returned 850/220/1070).
    const gen = byName['POST /api/resume/generate'];
    console.log('[debug] gen.tokens_per_call=', JSON.stringify(gen.tokens_per_call));
    assert.ok(gen.tokens_per_call, 'generate must have tokens_per_call');
    // Total tokens for endpoint = sum across calls. Mock returns 1070 per call,
    // so endpoint total must be a positive multiple of 1070.
    assert.ok(gen.tokens_per_call.total > 0, 'generate total tokens > 0');
    assert.equal(gen.tokens_per_call.total % 1070, 0, 'generate total is multiple of 1070');
    assert.ok(gen.tokens_per_call.calls >= 1, 'at least one DeepSeek call');

    const match = byName['POST /api/match'];
    console.log('[debug] match.tokens_per_call=', JSON.stringify(match.tokens_per_call));
    assert.ok(match.tokens_per_call, 'match must have tokens_per_call');
    assert.ok(match.tokens_per_call.calls >= 5, 'match has many LLM calls (no cache)');
    assert.ok(match.tokens_per_call.total > 0, 'match total tokens > 0');
    assert.equal(match.tokens_per_call.total % 1070, 0, 'match total is multiple of 1070');

    // Non-LLM endpoints must show "(no LLM)"
    assert.equal(byName['GET /api/health'].tokens_per_call, null);

    // fetch mock must have been called for LLM endpoints
    assert.ok(llmCalls > 0, 'DeepSeek fetch mock should have fired');
  } finally {
    globalThis.fetch = origFetch;
  }
});