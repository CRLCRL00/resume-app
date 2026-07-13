/**
 * Sentry mini-program config sanity check
 *
 * 不测 SDK 内部行为（sentry-miniapp 自带 100% 覆盖），只测我们的接入姿势对：
 *   1. utils/sentry.js 存在且能 require
 *   2. src/config.example.js 存在（模板）
 *   3. src/config.js 默认是 placeholder / 空 DSN（不能 hardcode 真值）
 *   4. app.js 在 reportClientError 之前 require sentry（确保 init 在 App() 前）
 *   5. beforeSend 含 PII strip（user.ip_address / user.email）
 *
 * 真 DSN 通过 src/config.js 注入（gitignored），不入仓。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('utils/sentry.js exists', () => {
  assert.ok(fs.existsSync(path.join(root, 'utils/sentry.js')), 'utils/sentry.js must exist');
});

test('src/config.example.js exists (template)', () => {
  assert.ok(fs.existsSync(path.join(root, 'src/config.example.js')), 'src/config.example.js must exist');
});

test('src/config.js defaults to placeholder / no real DSN', () => {
  const cfg = require(path.join(root, 'src/config.js'));
  // 模板默认空 DSN —— 真值在部署时由 ops 注入
  assert.equal(typeof cfg.sentryDsnMp, 'string');
  assert.ok(cfg.sentryDsnMp.length < 64, `sentryDsnMp must be placeholder, got: "${cfg.sentryDsnMp.slice(0, 32)}..."`);
  assert.equal(cfg.environment, 'development');
  assert.equal(cfg.appVersion, 'dev');
});

test('utils/sentry.js strips PII in beforeSend', () => {
  const src = fs.readFileSync(path.join(root, 'utils/sentry.js'), 'utf8');
  assert.match(src, /beforeSend/, 'beforeSend hook must exist');
  assert.match(src, /delete event\.user\.ip_address/, 'must strip user.ip_address');
  assert.match(src, /delete event\.user\.email/, 'must strip user.email');
});

test('app.js requires sentry before App() registration', () => {
  const src = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const sentryIdx = src.indexOf("require('./utils/sentry')");
  const appIdx = src.indexOf('App({');
  assert.ok(sentryIdx > -1, "must require('./utils/sentry')");
  assert.ok(appIdx > -1, 'App({ must exist');
  assert.ok(sentryIdx < appIdx, 'sentry require must come before App()');
});

test('sentry-miniapp is in devDependencies', () => {
  const pkg = require(path.join(root, 'package.json'));
  assert.ok(pkg.devDependencies['sentry-miniapp'], 'sentry-miniapp must be in devDependencies');
});
