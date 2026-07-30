#!/usr/bin/env node
/**
 * 上传小程序 source map 到 Sentry
 *
 * 流程：
 *   1. sentry-cli releases new <release>
 *   2. sentry-cli releases files <release> upload-sourcemaps ./dist \
 *        --url-prefix 'app:///' --ext js --ext map
 *
 * 必需 env：
 *   SENTRY_AUTH_TOKEN  — Sentry user auth token (Settings → Auth Tokens)
 *   SENTRY_ORG         — org slug
 *   SENTRY_PROJECT     — project slug
 * 可选 env：
 *   SENTRY_DIST_DIR    — source map 目录 (default: ./dist)
 *   SENTRY_URL_PREFIX  — virtual path prefix (default: app:///)
 *
 * 用法：
 *   SENTRY_AUTH_TOKEN=... SENTRY_ORG=... SENTRY_PROJECT=... \
 *     node scripts/upload-sourcemaps.js [release-name]
 *   release-name 不传时默认 <package.name>@<package.version>
 *
 * 装 sentry-cli（一次性）：
 *   npm install -g @sentry/cli
 *   或 brew install getsentry/tools/sentry-cli
 *   或 curl -sL https://sentry.io/get-cli/ | bash
 */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const release = process.argv[2] || `${pkg.name}@pkg.version`;

const distDir = process.env.SENTRY_DIST_DIR || path.join(root, 'dist');
const urlPrefix = process.env.SENTRY_URL_PREFIX || 'app:///';

const required = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`missing required env vars: ${missing.join(', ')}`);
  console.error('see scripts/upload-sourcemaps.js header comment');
  process.exit(1);
}

if (!fs.existsSync(distDir)) {
  console.error(`dist dir not found: ${distDir}`);
  console.error('build first (or set SENTRY_DIST_DIR)');
  process.exit(1);
}

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: root });
}

try {
  // 1. 创建 release（已存在不会报错）
  run(`npx --yes sentry-cli releases new "${release}"`);

  // 2. 上传 source map（ext: js + map，url-prefix 必须和 sentry.init 的 enableSourceMap 默认值一致）
  run(
    `npx --yes sentry-cli releases files "${release}" upload-sourcemaps "${distDir}" ` +
    `--url-prefix "${urlPrefix}" --ext js --ext map`
  );

  // 3. 标记 final（防止后续 deploy commit 又写错 stack trace）
  run(`npx --yes sentry-cli releases finalize "${release}"`);

  console.log(`\nsource maps uploaded for release "${release}"`);
  console.log(`Sentry dashboard: https://${process.env.SENTRY_ORG}.sentry.io/releases/${encodeURIComponent(release)}/`);
} catch (err) {
  console.error('upload-sourcemaps failed:', err.message);
  process.exit(1);
}
