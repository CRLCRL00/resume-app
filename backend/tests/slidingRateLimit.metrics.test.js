const test = require('node:test');
const assert = require('node:assert/strict');
const client = require('prom-client');

// ---- Stub Redis (copied from slidingRateLimit.test.js to keep this file self-contained) ----
function createStubRedis(opts = {}) {
  const failOn = opts.failOn || (() => false);
  const zsets = new Map();      // key → Map<member, score>
  const expires = new Map();    // key → expireAt ms
  const handlers = {
    zremrangebyscore: (key, _min, max) => {
      const z = zsets.get(key);
      if (!z) return 0;
      let removed = 0;
      for (const [m, s] of [...z.entries()]) {
        if (s <= max) { z.delete(m); removed++; }
      }
      return removed;
    },
    zcard: (key) => zsets.get(key)?.size || 0,
    zadd: (key, score, member) => {
      let z = zsets.get(key);
      if (!z) { z = new Map(); zsets.set(key, z); }
      z.set(member, score);
      return 1;
    },
    zrange: (key, start, stop, withScores) => {
      const z = zsets.get(key);
      if (!z) return [];
      const arr = [...z.entries()].sort((a, b) => a[1] - b[1]);
      const sliced = arr.slice(start, stop === -1 ? undefined : stop + 1);
      if (!withScores) return sliced.map(([m]) => m);
      const out = [];
      for (const [m, s] of sliced) { out.push(m, String(s)); }
      return out;
    },
    pexpire: (key, ms) => { expires.set(key, Date.now() + ms); return 1; },
  };

  function makePipeline() {
    const queued = [];
    const pipeline = {
      zremrangebyscore: (...a) => { queued.push(['zremrangebyscore', ...a]); return pipeline; },
      zcard: (...a) => { queued.push(['zcard', ...a]); return pipeline; },
      zadd: (...a) => { queued.push(['zadd', ...a]); return pipeline; },
      pexpire: (...a) => { queued.push(['pexpire', ...a]); return pipeline; },
    };
    pipeline.exec = async () => {
      const results = [];
      for (const [name, ...args] of queued) {
        if (failOn(name)) {
          results.push([new Error(`stub fail: ${name}`), null]);
          continue;
        }
        try {
          results.push([null, handlers[name](...args)]);
        } catch (e) {
          results.push([e, null]);
        }
      }
      return results;
    };
    return pipeline;
  }

  return {
    zsets, expires,
    multi: makePipeline,
    zremrangebyscore: (...a) => handlers.zremrangebyscore(...a),
    zcard: (...a) => handlers.zcard(...a),
    zadd: (...a) => handlers.zadd(...a),
    zrange: (...a) => handlers.zrange(...a),
    pexpire: (...a) => handlers.pexpire(...a),
    _peek: (key) => [...(zsets.get(key)?.entries() || [])],
    _forceExpire: (key) => { zsets.delete(key); expires.delete(key); },
  };
}

function loadMiddlewareWithStub(stub) {
  const redisPath = require.resolve('../src/config/redis');
  const original = require.cache[redisPath];
  require.cache[redisPath] = {
    id: redisPath,
    filename: redisPath,
    loaded: true,
    exports: stub,
    paths: original ? original.paths : [],
  };
  const mwPath = require.resolve('../src/middleware/slidingRateLimit');
  delete require.cache[mwPath];
  // eslint-disable-next-line global-require
  return require('../src/middleware/slidingRateLimit');
}

function restoreCache(stub) {
  const redisPath = require.resolve('../src/config/redis');
  delete require.cache[redisPath];
  const mwPath = require.resolve('../src/middleware/slidingRateLimit');
  delete require.cache[mwPath];
  // eslint-disable-next-line no-unused-vars
  void stub;
}

// 重置 counter 状态 + 重新要求 middleware（注入 stub）
// 重要：prom-client registry 是 singleton（globalThis 防重），但 counter 内的
// per-label 数值需要 reset()。同时清掉 metrics.js 等后续单测可能 require 的缓存，
// 避免我们的 stub redis 被其他测试看到。
async function setupFresh(stub) {
  // 移除 metrics.js / slidingRateLimit.js 缓存，让下一次 require 重新读取 stub
  const metricsPath = require.resolve('../src/routes/metrics');
  delete require.cache[metricsPath];

  const mw = loadMiddlewareWithStub(stub);
  const counter = mw.slidingRateLimitDecisions || client.register.getSingleMetric('sliding_rate_limit_decisions_total');
  if (counter && counter.reset) counter.reset();
  return { mw, counter };
}

function makeRes() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    body: undefined,
    set(k, v) { headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

// 读 counter 在指定 label-set 下的值（无记录则 0）
// 查询 counter 在指定 label-set 下的值（无记录则 0）
async function getCounterValue(counter, labels) {
  const data = await counter.get();
  for (const v of data.values) {
    const ok = Object.keys(labels).every((k) => v.labels && v.labels[k] === labels[k]);
    if (ok) return v.value;
  }
  return 0;
}

// ============================================================
// Test 1: 3 sequential allowed → allowed counter increments by 3
// ============================================================
test('slidingRateLimit metrics: 3 allowed → decisions counter{name:login,decision:allowed} += 3', async () => {
  const stub = createStubRedis();
  const { mw, counter } = await setupFresh(stub);
  const { slidingRateLimit } = mw;

  const before = await getCounterValue(counter, { name: 'sliding:login', decision: 'allowed' });

  const key = 'rl:sliding:login:ip:1.1.1.1';
  await slidingRateLimit({ metricName: 'login', key, limit: 10, windowMs: 60_000 });
  await slidingRateLimit({ metricName: 'login', key, limit: 10, windowMs: 60_000 });
  await slidingRateLimit({ metricName: 'login', key, limit: 10, windowMs: 60_000 });

  const after = await getCounterValue(counter, { name: 'sliding:login', decision: 'allowed' });
  assert.equal(after - before, 3, 'allowed counter should increment by 3');

  // 文本输出验证：prometheus exposition format 包含我们的 counter
  const allMetrics = await client.register.metrics();
  assert.match(allMetrics, /sliding_rate_limit_decisions_total\{[^}]*name="sliding:login"[^}]*decision="allowed"[^}]*\} \d+/);

  restoreCache(stub);
});

// ============================================================
// Test 2: hit limit then 1 blocked → blocked counter +1
// ============================================================
test('slidingRateLimit metrics: at-limit + 1 blocked → decisions counter{decision:blocked} += 1', async () => {
  const stub = createStubRedis();
  const { mw, counter } = await setupFresh(stub);
  const { slidingRateLimitMiddleware } = mw;

  const before = await getCounterValue(counter, { name: 'sliding:login', decision: 'blocked' });
  const allowedBefore = await getCounterValue(counter, { name: 'sliding:login', decision: 'allowed' });

  const handler = slidingRateLimitMiddleware({
    name: 'login',
    limit: 3,
    windowMs: 60_000,
    keyFn: () => 'ip-xyz',
  });

  // 3 次放行（占满 limit）
  for (let i = 0; i < 3; i++) {
    const res = makeRes();
    await handler({ ip: 'x' }, res, () => {});
  }
  // 第 4 次：blocked
  const res = makeRes();
  let nextCalled = false;
  await handler({ ip: 'x' }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 429);

  const after = await getCounterValue(counter, { name: 'sliding:login', decision: 'blocked' });
  const allowedAfter = await getCounterValue(counter, { name: 'sliding:login', decision: 'allowed' });
  assert.equal(after - before, 1, 'blocked counter should increment by 1');
  assert.equal(allowedAfter - allowedBefore, 3, 'allowed counter should increment by 3');

  restoreCache(stub);
});

// ============================================================
// Test 3: Redis fail-open → failopen counter +1
// ============================================================
test('slidingRateLimit metrics: redis error → fail-open counter{decision:failopen} += 1', async () => {
  const failStub = {
    multi: () => ({
      zremrangebyscore: () => failStub.multi(),
      zcard: () => failStub.multi(),
      zadd: () => failStub.multi(),
      pexpire: () => failStub.multi(),
      exec: async () => { throw new Error('redis connection refused'); },
    }),
    zrange: async () => { throw new Error('redis connection refused'); },
  };

  const { mw, counter } = await setupFresh(failStub);
  const { slidingRateLimit } = mw;

  const before = await getCounterValue(counter, { name: 'sliding:resume-generate', decision: 'failopen' });

  const r = await slidingRateLimit({
    metricName: 'resume-generate',
    key: 'rl:sliding:resume-generate:ip:x',
    limit: 5,
    windowMs: 1000,
  });
  assert.equal(r.allowed, true, 'should fail-open');
  assert.ok(r.error);

  const after = await getCounterValue(counter, { name: 'sliding:resume-generate', decision: 'failopen' });
  assert.equal(after - before, 1, 'failopen counter should increment by 1');

  restoreCache(failStub);
});
