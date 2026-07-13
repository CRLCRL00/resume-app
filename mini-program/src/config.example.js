/**
 * 小程序运行时配置（runtime config，非 env）
 *
 * WeChat mini-program 沙箱里没有 process.env，所以 env-style 注入走不通。
 * 改用 src/config.js 文件，模板是本文件：
 *   1. cp src/config.example.js src/config.js
 *   2. 编辑 src/config.js 填真值
 *   3. src/config.js 已在 .gitignore，绝不入仓
 *
 * 真值只能放在 src/config.js（部署时手动同步或脚本注入）。
 * 发布前 grep 仓库确认无 SENTRY_DSN_MP 真值泄露。
 */
module.exports = {
  // Sentry DSN（去 sentry.io 项目 Settings → Client Keys (DSN) 拷）
  // 留空 → sentry.init() no-op（不报错，不上传）
  sentryDsnMp: '',

  // release tag：必须和 sentry-cli 上传 source map 时的 release 一致
  // 例 'my-miniapp@1.0.0'，CI 里取 package.json#version
  appVersion: 'dev',

  // environment：development / staging / production
  environment: 'development',
};
