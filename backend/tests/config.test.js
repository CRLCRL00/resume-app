const { test } = require('node:test');
const assert = require('node:assert/strict');

// 先把 .env 加载到 process.env
require('../src/config');

test('config exports env values', () => {
  const config = require('../src/config');
  assert.ok(config.PORT, 'PORT should be defined');
  assert.ok(config.DB_HOST, 'DB_HOST should be defined');
  assert.ok(config.JWT_SECRET, 'JWT_SECRET should be defined');
});

test('config validates required keys', () => {
  // 临时清空关键 key，应该抛错
  const orig = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  delete require.cache[require.resolve('../src/config')];
  assert.throws(() => require('../src/config'), /JWT_SECRET/);
  process.env.JWT_SECRET = orig;
});