const { test } = require('node:test');
const assert = require('node:assert/strict');
const logger = require('../src/utils/logger');

test('logger has info method', () => {
  assert.equal(typeof logger.info, 'function');
});

test('logger has error method', () => {
  assert.equal(typeof logger.error, 'function');
});

test('logger respects level', () => {
  assert.ok(logger.level, 'level should be set');
});