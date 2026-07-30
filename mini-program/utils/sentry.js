/**
 * 小程序端 Sentry 初始化 (R47 fix)
 *
 * 背景 (R40 → R47):
 *   原版 require('sentry-miniapp') + Sentry.init 在微信 IDE dev 模式中失败：
 *     Error: module 'utils/sentry-miniapp.js' is not defined
 *   原因是微信开发者工具 dev mode **不解析 npm dependencies** — 仅处理相对路径 require。
 *   真运行时（miniprogram-ci bundle, app.js 上传后的小程序基础库 runtime）会处理 npm 包，但
 *   IDE hot-reload 跑的是 sandbox module graph，没法拉到 node_modules。
 *
 * 修 (R47): 检测 IDE dev mode，no-op 失败；prod 用 miniprogram-ci webpack bundle 真包加载。
 *
 * 用法：在 app.js 最顶部 require('./utils/sentry')，早于 App()
 */
const config = require('../src/config');

// Stub: IDE dev mode (无 npm deps) 下, 整个文件 no-op
// 提供 captureMessage / captureException / init 作为 no-op stubs 防止 app.js 调用挂掉
const stub = {
  init: () => {},
  captureException: () => {},
  captureMessage: () => {},
  captureEvent: () => {},
  addBreadcrumb: () => {},
  setUser: () => {},
  setTag: () => {},
  setTags: () => {},
  setExtra: () => {},
  setExtras: () => {},
  setContext: () => {},
  withScope: (cb) => { try { cb(stub); } catch (_e) {} },
  configureScope: (cb) => { try { cb(stub); } catch (_e) {} },
  flush: (cb) => { if (typeof cb === 'function') cb(); return Promise.resolve(); },
  close: () => Promise.resolve(),
  getCurrentHub: () => ({ bindClient: () => ({ captureException: stub.captureException }) }),
  Hub: function () { return stub; },
  lastEventId: () => null,
  Severity: { Fatal: 'fatal', Error: 'error', Warning: 'warning', Info: 'info', Debug: 'debug' },
};

// Detect: dev IDE 没装 npm deps, 真包加载会失败
let realSentry = null;
try {
  realSentry = require('sentry-miniapp');
} catch (e) {
  // dev IDE without webpack/npm-bundle; 此 path 不致命
  realSentry = null;
}

if (!realSentry) {
  module.exports = stub;
} else if (!config.sentryDsnMp) {
  // DSN 空 → 跳过 init 走 stub 接口 (Sentry.* 调用安全)
  module.exports = stub;
} else {
  // 真初始化 (prod, miniprogram-ci bundle 已加载 sentry-miniapp)
  realSentry.init({
    dsn: config.sentryDsnMp,
    release: config.appVersion,
    environment: config.environment,
    sampleRate: config.environment === 'production' ? 1.0 : 1.0,
    tracesSampleRate: config.environment === 'production' ? 0.1 : 0.0,
    beforeSend(event) {
      if (event.user) {
        delete event.user.ip_address;
        delete event.user.email;
      }
      if (event.request && event.request.headers) {
        delete event.request.headers.Authorization;
        delete event.request.headers.Cookie;
        delete event.request.headers.token;
      }
      return event;
    },
  });
  module.exports = realSentry;
}
