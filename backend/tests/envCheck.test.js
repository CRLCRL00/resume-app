const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('check-env.js passes with all required vars set', () => {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: '3000',
    WX_APPID: 'wx_your_appid_real_test',
    WX_SECRET: 'abcdef0123456789abcdef',
    JWT_SECRET: 'a'.repeat(40),
    JWT_EXPIRES_IN: '30d',
    DB_HOST: '127.0.0.1',
    DB_USER: 'root',
    DB_PASSWORD: 'pw',
    DB_NAME: 'test_db',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: '6379',
  };
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'check-env.js')], { env, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `script output: ${r.stdout} ${r.stderr}`);
});

test('check-env.js exits 1 when JWT_SECRET too short', () => {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: '3000',
    WX_APPID: 'wx_your_appid_real_test',
    WX_SECRET: 'abcdef0123456789abcdef',
    JWT_SECRET: 'short',
    JWT_EXPIRES_IN: '30d',
    DB_HOST: '127.0.0.1',
    DB_USER: 'root',
    DB_PASSWORD: 'pw',
    DB_NAME: 'test_db',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: '6379',
  };
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'check-env.js')], { env, encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
});
