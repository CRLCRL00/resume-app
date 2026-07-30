const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ---- Stub Redis ----
// 内存 ZSET，模拟 ZREMRANGEBYSCORE / ZCARD / ZADD / PEXPIRE / ZRANGE
// key → Map<member, score> ; 另存 expireAt[key] = ms
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
    // 测试辅助：直接看内部
    _peek: (key) => [...(zsets.get(key)?.entries() || [])],
    // 测试辅助：强制清空（模拟窗口过期，避免 real-time sleep 漂移）
    _forceExpire: (key) => { zsets.delete(key); expires.delete(key); },
  };
}

// ---- 注入 stub 到 require.cache ----
function loadMiddlewareWithStub(stub) {
  const redisPath = require.resolve('../src/config/redis');
  // 保存原 module（如有）
  const original = require.cache[redisPath];
  require.cache[redisPath] = {
    id: redisPath,
    filename: redisPath,
    loaded: true,
    exports: stub,
    paths: original ? original.paths : [],
  };
  // 清除 middleware 自身的缓存以重新 require
  const mwPath = require.resolve('../src/middleware/slidingRateLimit');
  delete require.cache[mwPath];
  // eslint-disable-next-line global-require
  const mw = require('../src/middleware/slidingRateLimit');
  return mw;
}

function restoreCache(stub) {
  const redisPath = require.resolve('../src/config/redis');
  // 清理注入，让后续 require 重新走真实模块
  delete require.cache[redisPath];
  // 清掉 middleware 缓存
  const mwPath = require.resolve('../src/middleware/slidingRateLimit');
  delete require.cache[mwPath];
  // eslint-disable-next-line no-unused-vars
  void stub;
}

// ---- helpers ----
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

// ============================================================
// Test 1: under limit, allowed
// ============================================================
test('slidingRateLimit: under limit → allowed with count+1', async () => {
  const stub = createStubRedis();
  const { slidingRateLimit } = loadMiddlewareWithStub(stub);

  const key = 'rl:sliding:test-under:ip:1.2.3.4';
  const r1 = await slidingRateLimit({ key, limit: 5, windowMs: 60_000 });
  assert.equal(r1.allowed, true);
  assert.equal(r1.count, 1);

  const r2 = await slidingRateLimit({ key, limit: 5, windowMs: 60_000 });
  assert.equal(r2.allowed, true);
  assert.equal(r2.count, 2);

  const r3 = await slidingRateLimit({ key, limit: 5, windowMs: 60_000 });
  assert.equal(r3.allowed, true);
  assert.equal(r3.count, 3);

  // ZSET 实际写入
  assert.equal(stub._peek(key).length, 3);

  restoreCache(stub);
});

// ============================================================
// Test 2: at limit, blocked (count == limit → 429)
// ============================================================
test('slidingRateLimit: at limit (count == limit) → blocked, returns 429 via middleware', async () => {
  const stub = createStubRedis();
  const { slidingRateLimitMiddleware } = loadMiddlewareWithStub(stub);

  const mw = slidingRateLimitMiddleware({
    name: 'login',
    limit: 3,
    windowMs: 60_000,
    keyFn: () => 'ip-abc',
  });

  // 先填满到 limit
  for (let i = 0; i < 3; i++) {
    const res = makeRes();
    let nextCalled = false;
    await mw({ ip: 'x' }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, `req ${i + 1} should pass`);
  }

  // 第 4 次：应被 429 拦截
  const res = makeRes();
  let nextCalled = false;
  await mw({ ip: 'x' }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false, 'req 4 should be blocked');
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.code, 1429);
  assert.equal(res.body.message, 'too many requests');
  assert.ok(typeof res.body.retryAfterMs === 'number');
  assert.equal(res.headers['X-RateLimit-Limit'], '3');
  assert.equal(res.headers['X-RateLimit-Remaining'], '0');
  assert.ok(res.headers['Retry-After']);

  restoreCache(stub);
});

// ============================================================
// Test 3: above limit, blocked with retry-after
// ============================================================
test('slidingRateLimit: above limit → blocked with retry-after matching windowMs', async () => {
  const stub = createStubRedis();
  const { slidingRateLimit } = loadMiddlewareWithStub(stub);

  const key = 'rl:sliding:test-above:ip:5.6.7.8';
  const limit = 2;
  const windowMs = 1000;

  const r1 = await slidingRateLimit({ key, limit, windowMs });
  const r2 = await slidingRateLimit({ key, limit, windowMs });
  assert.equal(r1.allowed, true);
  assert.equal(r2.allowed, true);

  // 第 3 次触发拒绝
  const before = Date.now();
  const r3 = await slidingRateLimit({ key, limit, windowMs });
  const after = Date.now();

  assert.equal(r3.allowed, false);
  assert.equal(r3.count, 2);
  assert.ok(r3.retryAfterMs >= 0);
  // retry-after 应当接近 windowMs（最旧条目刚加进去，还没过期）
  assert.ok(r3.retryAfterMs <= windowMs + (after - before) + 10);
  assert.ok(r3.retryAfterMs >= windowMs - (after - before) - 10);

  restoreCache(stub);
});

// ============================================================
// Test 4: Redis down (mock throws) → fail-open
// ============================================================
test('slidingRateLimit: redis error → fail-open (allowed) + warns', async () => {
  // 所有 multi() 调用都抛错（模拟 Redis 完全挂掉）
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

  const { slidingRateLimit, slidingRateLimitMiddleware } = loadMiddlewareWithStub(failStub);

  // 直接函数调用
  const r = await slidingRateLimit({ key: 'rl:sliding:test-failopen:ip:x', limit: 5, windowMs: 1000 });
  assert.equal(r.allowed, true);
  assert.equal(r.count, 0);
  assert.ok(r.error);

  // 中间件形式也必须放行
  const mw = slidingRateLimitMiddleware({
    name: 'failopen',
    limit: 5,
    windowMs: 1000,
    keyFn: () => 'x',
  });
  const res = makeRes();
  let nextCalled = false;
  await mw({}, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true, 'middleware should fail-open');
  assert.equal(res.statusCode, 200);

  restoreCache(failStub);
});

// ============================================================
// Test 5: after window expires, allowed again
// ============================================================
test('slidingRateLimit: after window expires, requests allowed again', async () => {
  const stub = createStubRedis();
  const { slidingRateLimit } = loadMiddlewareWithStub(stub);

  const key = 'rl:sliding:test-window:ip:9.9.9.9';
  const limit = 2;
  const windowMs = 10000; // 长窗口保证 r1-r3 不会跨过；用 stub._forceExpire 模拟过期

  const r1 = await slidingRateLimit({ key, limit, windowMs });
  const r2 = await slidingRateLimit({ key, limit, windowMs });
  const r3 = await slidingRateLimit({ key, limit, windowMs });
  assert.equal(r1.allowed, true);
  assert.equal(r2.allowed, true);
  assert.equal(r3.allowed, false, 'third request should be blocked');

  // 模拟窗口过期（避免 real-time sleep 在 CI 上漂移）
  stub._forceExpire(key);

  const r4 = await slidingRateLimit({ key, limit, windowMs });
  assert.equal(r4.allowed, true, 'after window expiry, should be allowed');
  assert.equal(r4.count, 1, 'old entries should be cleared, count resets');

  restoreCache(stub);
});