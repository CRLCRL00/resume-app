const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sign, verify } = require('../src/services/token');

test('sign then verify returns same payload', () => {
  const payload = { userId: 1, openid: 'o123' };
  const token = sign(payload);
  const decoded = verify(token);
  assert.equal(decoded.userId, 1);
  assert.equal(decoded.openid, 'o123');
});

test('verify throws on invalid token', () => {
  assert.throws(() => verify('invalid.token.here'), /jwt/i);
});

test('verify throws on expired token', () => {
  const jwt = require('jsonwebtoken');
  const config = require('../src/config');
  const expired = jwt.sign({ userId: 1 }, config.JWT_SECRET, { expiresIn: '-1s' });
  assert.throws(() => verify(expired), /expired/i);
});
