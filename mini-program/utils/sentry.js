/**
 * 小程序端 Sentry 初始化
 *
 * 用法：在 app.js 最顶部 require('./utils/sentry')，早于 App()
 * （否则 SDK 无法 wrap onLaunch，第一帧 cold-start timing 丢失）
 *
 * PII 过滤：strip user.ip_address + user.email + custom header
 * source map：见 scripts/upload-sourcemaps.js
 */
const Sentry = require('sentry-miniapp');
const config = require('../src/config');

// DSN 空 → 跳过 init，整个 module 静默 no-op（业务代码 Sentry.* 调用安全）
if (!config.sentryDsnMp) {
  // 不 throw，不 console.warn 噪音（开发环境常见现象）
  module.exports = Sentry;
} else {
  Sentry.init({
    dsn: config.sentryDsnMp,
    release: config.appVersion,
    environment: config.environment,
    // 生产 10% 采样；其他环境 0（避免噪音 + 配额）
    sampleRate: config.environment === 'production' ? 1.0 : 1.0, // 错误事件本身不抽
    tracesSampleRate: config.environment === 'production' ? 0.1 : 0.0,
    beforeSend(event) {
      // PII strip
      if (event.user) {
        delete event.user.ip_address;
        delete event.user.email;
      }
      // strip wx.request header 里可能带的 token / cookie
      if (event.request && event.request.headers) {
        delete event.request.headers.Authorization;
        delete event.request.headers.Cookie;
        delete event.request.headers.token;
      }
      return event;
    },
  });
  module.exports = Sentry;
}
