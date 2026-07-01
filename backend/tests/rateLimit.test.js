const test = require('node:test');
const assert = require('node:assert/strict');
const { resumeLimiter, matchLimiter } = require('../src/middleware/rateLimit');

test('resumeLimiter is callable function (middleware shape)', () => {
  assert.equal(typeof resumeLimiter, 'function');
  assert.equal(typeof matchLimiter, 'function');
});

test('in test env, resumeLimiter is no-op (calls next)', () => {
  process.env.NODE_ENV = 'test';
  let calledNext = false;
  const fakeReq = { ip: '127.0.0.1' };
  const fakeRes = {};
  resumeLimiter(fakeReq, fakeRes, () => { calledNext = true; });
  assert.equal(calledNext, true);
});

test('in test env, matchLimiter is no-op (calls next)', () => {
  process.env.NODE_ENV = 'test';
  let calledNext = false;
  const fakeReq = { ip: '127.0.0.1' };
  const fakeRes = {};
  matchLimiter(fakeReq, fakeRes, () => { calledNext = true; });
  assert.equal(calledNext, true);
});