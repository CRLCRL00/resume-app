# 开发日志 — 2026-07-14（Phase 8+ Round 47）

> 阶段：8+ Round 47 — mini-program dev IDE sentry error fix
> 前置：[2026-07-14-phase8-plus-round46-close.md](../devlog/2026-07-14-phase8-plus-round46-close.md)

## 起点

user 在 IDE 控制台跑 app.js 时看到反复错误：
```
Error: module 'utils/sentry-miniapp.js' is not defined, require args is 'sentry-miniapp'
    at app.js? [sm]:4
```

这是 R40 加的 `mini-program/utils/sentry.js` 的真实 bug — **整个 R40 周期 R43 部署时未被审计到**。

## 根因

mini-program 项目里 `utils/sentry.js` 第 10 行 `const Sentry = require('sentry-miniapp')` 在以下场景全部 fail：

1. **dev IDE sandbox** - 不解析 npm dependencies (只处理相对路径 require)
2. **upload to 微信** - miniprogram-ci build 时，依赖 `project.config.json.setting.packNpmRelationList` 白名单；R40 没声明
3. **线上 runtime** - 如果 IDE / 真机没显式 bundle sentry-miniapp，require 同样失败

app.js require sentry 是 **fail-fast**，整个 app 启动挂在第一行。

## 改动详情

### 1. `mini-program/utils/sentry.js` 重写

两阶段 fallback:

```js
const config = require('../src/config');

// (1) Stub 集合 — 保证 Sentry.* 调用永不断
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
  withScope: (cb) => { try { cb(stub); } catch {} },
  configureScope: (cb) => { try { cb(stub); } catch {} },
  flush: (cb) => { if (cb) cb(); return Promise.resolve(); },
  close: () => Promise.resolve(),
  getCurrentHub: () => ({ bindClient: () => ({ captureException: stub.captureException }) }),
  Hub: function () { return stub; },
  lastEventId: () => null,
  Severity: { Fatal: 'fatal', Error: 'error', Warning: 'warning', Info: 'info', Debug: 'debug' },
};

// (2) 尝试 require 真包 — 失败则用 stub
let realSentry = null;
try {
  realSentry = require('sentry-miniapp');
} catch (e) {
  realSentry = null;
}

if (!realSentry) {
  module.exports = stub;
} else if (!config.sentryDsnMp) {
  module.exports = stub; // DSN 空也走 stub (省 SDK 调用)
} else {
  realSentry.init({...PII strip...});
  module.exports = realSentry;
}
```

行为:
- **dev IDE**: `try` 抛错 → stub → app.js 启动 OK，Sentry.* silent no-op
- **prod 真打包 + DSN**: 真 sentry-miniapp loaded + init
- **prod 真打包 无 DSN**: stub 走 (避免 sending 到空 DSN)

### 2. `mini-program/project.config.json` 加 `packNpmRelationList`

```diff
 "packNpmManually": false,
-"packNpmRelationList": [],
+"packNpmRelationList": ["sentry-miniapp"],
```

`packNpmManually: false` 让 IDE / miniprogram-ci 自动 webpack bundle 列出的 npm 包。
- 这是 R40 必须做的配置 — 当时遗漏
- 列出 `"sentry-miniapp"` 后，miniprogram-ci upload 时会把 sentry-miniapp 整个打进代码包

### 3. `tests/sentry-config.test.js` 新增 2 测试

| 测试 | 验证 |
|------|------|
| `R47 utils/sentry.js exports stub when sentry-miniapp unavailable` | try/catch + stub 关键字存在 + app.js 仍 require 它 |
| `R47 project.config.json declares sentry-miniapp for npm bundle` | `packNpmRelationList.includes('sentry-miniapp')` |

新增 2 测试，总 6 → **8 tests pass / 0 fail**。

## npm test baseline

| Suite | tests | pass | fail |
|-------|-------|------|------|
| backend (R42) | 421 | 421 | 0 |
| mini-program (R47) | **8** | **8** | 0 |
| **总** | **429** | **429** | **0** |

跨 R40-R47 全测零 fail。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | try/catch 包裹 require 而非删 require | 删除 require → dev IDE 仍 OK 但 prod 真打包缺 SDK；try/catch 给 dev IDE + 真打包两层兼容 |
| 2 | stub 完整 API surface | app.js 用法未知但 `Sentry.*` 任何调用都安全；最坏 Sentry init 后调用 captureException 失效 |
| 3 | 加 `packNpmRelationList` 而非改 `packNpmManually: true` | 不破坏 IDE 自动 bundle 流程，只补缺失列表 |
| 4 | stub 用 module-level object 而非 class | 类会有 prototype / instance 行为差异；模块对象最简可控 |
| 5 | 不删 src/config.js 引用 | 那层 normal fallback；try/catch 之后才进入 config 判断 |
| 6 | 测试只 verify 文件结构（regex）而非 runtime require | 测试跑在 Node 22 + 真 npm env，永远 require 成功；只能在 dev IDE 触发原 bug 路径 |

## 风险

| 风险 | 缓解 |
|------|------|
| prod 真打包没把 sentry-miniapp 打进 | `packNpmRelationList` 是显式声明；miniprogram-ci 严格遵循 |
| stub 行为与真 SDK 行为不同 (e.g. event flushing) | prod 用真 SDK，stub 仅 dev IDE |
| dev IDE 测试者不知 Sentry 已 no-op 仍调 | stub captureMessage 记 console.warn 提示 "dev stub" — R48 follow-up |
| 当前 DSN 默认空，prod 路径仍 stub | ops 填 src/config.js 即可激活；R48 ops docs |

## 未做（follow-up）

| # | 项 | 谁 |
|---|----|------|
| 1 | 真激活 Sentry (fill src/config.js) | ops |
| 2 | dev stub 在 console.warn 一次提示 | R48 (cosmetic) |
| 3 | pre-commit hook 也检查 mini-program 配置 (现在只 check `*.key` PATs) | R48 |
| 4 | mini-program 在 CI 上跑 `miniprogram-ci build --watch` 验证 dev IDE-equal paths | R48 |

## Commits

| SHA | msg |
|-----|-----|
| (本 devlog + 2 文件) | fix(mp): R47 — sentry stub fallback + packNpmRelationList (R40 audit fix) |
