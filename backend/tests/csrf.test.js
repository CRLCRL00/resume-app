const test = require('node:test');
const assert = require('node:assert/strict');
const { requireCsrf } = require('../src/middleware/csrf');

test('test env bypasses requireCsrf on mutating request', () => {
  let called = false;
  const req = { method: 'POST', headers: {}, user: {} };
  const res = {};
  requireCsrf(req, res, () => { called = true; });
  assert.strictEqual(called, true);
});

test('safe methods bypass requireCsrf regardless of header', () => {
  let called = false;
  const req = { method: 'GET', headers: {} };
  const res = {};
  requireCsrf(req, res, () => { called = true; });
  assert.strictEqual(called, true);
});

test('HEAD method bypasses requireCsrf', () => {
  let called = false;
  const req = { method: 'HEAD', headers: {} };
  const res = {};
  requireCsrf(req, res, () => { called = true; });
  assert.strictEqual(called, true);
});

test('OPTIONS method bypasses requireCsrf', () => {
  let called = false;
  const req = { method: 'OPTIONS', headers: {} };
  const res = {};
  requireCsrf(req, res, () => { called = true; });
  assert.strictEqual(called, true);
});