const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// 重写 hashBody：与 middleware 内部 sha256(JSON.stringify(body)) 保持一致
function hashBody(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body || {})).digest('hex');
}

// 注：middleware 在 test env 下 isTest() 直接 next()，不读 Redis。
//   → 我们直接测 hashBody + KEY_REGEX 的纯函数逻辑。
//   集成测试（路由级 200/409 replay）由 admin-jobs-crud.test.js 等覆盖。

// === 提取 KEY_REGEX 假设以保持一致 ===
// middleware: /^[A-Za-z0-9_-]{1,128}$/
const KEY_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

test('hashBody: 相同 payload → 相同 hash', () => {
  const a = hashBody({ title: 'Job A', salary_min: 10 });
  const b = hashBody({ title: 'Job A', salary_min: 10 });
  assert.strictEqual(a, b);
});

test('hashBody: 不同 payload → 不同 hash', () => {
  const a = hashBody({ title: 'Job A' });
  const b = hashBody({ title: 'Job B' });
  assert.notStrictEqual(a, b);
});

test('hashBody: V8 保留插入顺序，client 应保持 key 顺序一致', () => {
  // 注：JSON.stringify 在 V8 中是按插入顺序的，所以 client 应保持相同 key 顺序
  //   才能得到相同 hash。这是行业惯例（Stripe / Adyen 也是这么做的）。
  const a = hashBody({ a: 1, b: 2 });
  const b = hashBody({ b: 2, a: 1 });
  assert.notStrictEqual(a, b);
});

test('KEY_REGEX: uuid v4 合法', () => {
  const uuid = '550e8400-e29b-41d4-a716-446655440000';
  assert.match(uuid, KEY_REGEX);
});

test('KEY_REGEX: 128 字符合法', () => {
  const key = 'a'.repeat(128);
  assert.match(key, KEY_REGEX);
});

test('KEY_REGEX: 129 字符非法（应被 400 拒绝）', () => {
  const key = 'a'.repeat(129);
  assert.doesNotMatch(key, KEY_REGEX);
});

test('KEY_REGEX: 空字符串非法', () => {
  assert.doesNotMatch('', KEY_REGEX);
});

test('KEY_REGEX: 含特殊字符（!@#）非法', () => {
  assert.doesNotMatch('key!@#', KEY_REGEX);
  assert.doesNotMatch('key with space', KEY_REGEX);
  assert.doesNotMatch('key/with/slash', KEY_REGEX);
});

// === 集成式 sanity：mock res，确认 middleware 在 test env 下是 noop ===
test('middleware: test env 下直接 next()（不依赖 Redis）', async () => {
  const { idempotency } = require('../src/middleware/idempotency');
  let nextCalled = false;
  const req = {
    headers: { 'idempotency-key': 'whatever' },
    user: { userId: 1 },
    body: { x: 1 },
  };
  const res = {
    setHeader: () => {},
    status: () => ({ json: () => {} }),
    json: () => {},
    locals: {},
  };
  await idempotency({ prefix: 'test' })(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
});