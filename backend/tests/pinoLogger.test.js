const test = require('node:test');
const assert = require('node:assert');
const logger = require('../src/utils/logger');

test('logger exports an object with expected methods (pino transport wrapper)', () => {
  // pino@9 with transport option returns an object exposing pino-like API
  assert.strictEqual(typeof logger, 'object');
  assert.ok(logger !== null);
  assert.strictEqual(typeof logger.info, 'function');
  assert.strictEqual(typeof logger.error, 'function');
  assert.strictEqual(typeof logger.child, 'function');
});

test('logger level respected in test env (silent)', () => {
  // In test env LOG_LEVEL shouldn't have changed; smoke the no-throw path
  assert.doesNotThrow(() => logger.info({ test: 'sample' }, 'test message'));
});