# Sentry Integration (Mini-Program)

## Why

后端 Sentry 只覆盖 Node 进程。小程序运行在 WeChat 沙箱里，错误 stack 是 ES5 转译 + minify 后的乱码，需要 source map 反混淆 + 单独的 release tag。

Mini-program 端 SDK：[`sentry-miniapp`](https://github.com/lizhiyao/sentry-miniapp)（社区维护，已进 Sentry 官方 community-supported SDK 列表）。基于 `@sentry/core` v10，原生支持 WeChat mini-program 沙箱 API。

> Backend 的 Sentry 文档：[sentry (backend)](/operations/sentry)。两套 SDK **release tag 不能混用** —— backend 用 `<name>@<backend-version>`，mini-program 用 `<name>@mp-<run-number>`。

## How to enable

### 1. 装 SDK

```bash
cd mini-program
npm install --save-dev sentry-miniapp
```

`utils/sentry.js` 已在仓里（直接 require），`app.js` 顶部已 require 一次（早于 `App()`，确保 wrap onLaunch）。

### 2. 配 DSN

WeChat mini-program 沙箱里 **没有** `process.env`，env-style 注入走不通。改用 `src/config.js` 文件：

```bash
cd mini-program
cp src/config.example.js src/config.js
# 编辑 src/config.js，填 sentryDsnMp / appVersion / environment
```

`src/config.js` 已在 `.gitignore`，绝不会入仓。

`DSN` 在 Sentry → Settings → Projects → `<mp-project>` → Client Keys (DSN) 拷。

### 3. release tag 规则

`src/config.js` 的 `appVersion` 字段必须和 `scripts/upload-sourcemaps.js` 调用的 release tag 完全一致 —— 否则 source map 不会和事件关联。建议：

| Env | appVersion |
|---|---|
| dev (本地) | `dev` |
| staging | `resume-app-mini-program@staging-<date>` |
| production | `resume-app-mini-program@1.2.3`（和 `package.json` version 对齐） |

## What gets captured

`sentry-miniapp` 的 default integrations 覆盖：

1. `App.onError` — App 生命周期里捕获的脚本错误（替换或并存于现有 `reportClientError('app_onerror', ...)`，二选一）
2. `wx.onError` — 渲染层同步异常
3. `wx.onUnhandledRejection` — Promise 未捕获 reject
4. `wx.onPageNotFound` — 路由失败
5. `wx.onMemoryWarning` — 内存告警
6. **Network breadcrumbs** — wx.request 自动打点
7. **Session & network status** — 会话生命周期 + 网络切换（WiFi/4G/offline）

注意：现有 `utils/monitor.js → reportClientError()` 上报到自家 backend `/api/internal/client-errors`。SDK 接入后两条链路并存：

- 后端 client_errors 表：聚合统计、admin 端点查询、保留 30 天
- Sentry：stack trace 反混淆、release 关联、issue 聚合

业务代码无需二选一，**两条链都跑** —— 监控粒度和用途不同。

### Context attached per event

| Field | Source | Example |
|---|---|---|
| `environment` | `config.environment` | `production` |
| `release` | `config.appVersion` | `resume-app-mini-program@1.2.3` |
| `tags.platform` | `wx.getSystemInfoSync()` | `ios` / `android` / `devtools` |
| `tags.sdk` | auto | `sentry.miniapp` |
| `user.id` | (manual via `Sentry.setUser`) | openid（需手动设） |

## What gets stripped (`beforeSend`)

```js
beforeSend(event) {
  if (event.user) {
    delete event.user.ip_address;  // WeChat 沙箱无 IP，此项本来就是 undefined
    delete event.user.email;        // 微信未提供 email
  }
  if (event.request && event.request.headers) {
    delete event.request.headers.Authorization;
    delete event.request.headers.Cookie;
    delete event.request.headers.token;
  }
  return event;
}
```

`utils/monitor.js` 上报 backend 时也剥离了 openid（只发哈希后字段），两端防御纵深。

## Source map workflow

### 一次性：装 sentry-cli

```bash
npm install -g @sentry/cli
# 或
curl -sL https://sentry.io/get-cli/ | bash
# 或
brew install getsentry/tools/sentry-cli
```

### 手工上传（开发调试）

```bash
cd mini-program
SENTRY_AUTH_TOKEN=... \
SENTRY_ORG=my-org \
SENTRY_PROJECT=resume-app-mini-program \
npm run sentry:sourcemap -- 'resume-app-mini-program@1.0.0'
```

`upload-sourcemaps.js` 步骤：

1. `sentry-cli releases new <release>` —— 创建 release（已存在不报错）
2. `sentry-cli releases files <release> upload-sourcemaps ./dist --url-prefix 'app:///' --ext js --ext map`
3. `sentry-cli releases finalize <release>`

`url-prefix` 必须用 `app:///`（sentry-miniapp 默认把 stack 虚拟路径规整到这个 prefix）。

### CI：自动上传

`.github/workflows/sentry-mp.yml` 提供：

- **手动 trigger** (`workflow_dispatch`)：Actions 页面 Run workflow，可手动填 release tag
- **tag trigger**：`push` tag `mp-v*`（例如 `mp-v1.2.3`）自动触发

默认 **OFF**（不监听 `push` 到 `develop`），避免 dev 误触发垃圾 release。

需要的 GH Secrets：

| Secret | Source |
|---|---|
| `SENTRY_AUTH_TOKEN` | Sentry → Settings → Auth Tokens → Create Token (scope: `project:releases`, `org:read`) |
| `SENTRY_ORG` | org slug（URL 里的 subdomain） |
| `SENTRY_PROJECT_MP` | mini-program project slug（区别于 backend 的 `SENTRY_PROJECT`） |
| `WX_MINIPROGRAM_KEY_BASE64` | 复用 upload-miniprogram.yml 的 key（base64 编码的 private key 文件） |

### 构建产物约定

`miniprogram-ci build --output ./dist` 把构建产物（含 source map）输出到 `mini-program/dist/`。sentry-cli 只读 `.js` + `.map`，过滤 wxss/wxml/JSON 配置文件（自动）。

注意：source map 文件应 **不入仓**（已通过 `dist/` 在 `.gitignore`）。

## How to test integration

### 本地（无 source map）

在 `src/config.js` 设好 DSN 后，临时改 `utils/sentry.js` 加一行：

```js
setTimeout(() => Sentry.captureException(new Error('sentry-mp test')), 3000);
```

打开微信开发者工具 → 编译 → 跑 3 秒 → Sentry dashboard → Issues 列表看 `sentry-mp test`。

第一次 stack 是混淆后的乱码（无 source map）。属正常。

### 带 source map（生产流程验证）

1. `npm run sentry:sourcemap -- 'test-release@1.0.0'`
2. 在小程序里 throw 一个真异常
3. Sentry dashboard 看 stack trace，应该反混淆到原始 `utils/xxx.js:行号`

### 与 backend 区分

Sentry project 列表里 `resume-app-mini-program`（MP 端）和 backend 是两个独立 project。filter by `project:resume-app-mini-program` 只看 MP 端事件。

## Operational notes

- **DSN 改变**：sentry SDK 在内存里维护 client，DSN 改变需要重新发布小程序版本（`src/config.js` 是 build 产物里的，hot reload 不生效）
- **本地开发**：DSN 留空 → `utils/sentry.js` no-op，业务代码 `Sentry.*` 调用静默（不会 throw）
- **依赖升级**：`sentry-miniapp` 已加入 `mini-program/package.json` 的 `devDependencies`（注意：sentry SDK 是 devDep 因为它只在 dev/build 时被打入产物，不是运行时 npm 依赖）。升级时按 semver major 检查 API
- **release 命名冲突**：避免和 backend 用同一个 release tag —— `scripts/upload-sourcemaps.js` 默认 `<pkg.name>@<pkg.version>`，pkg.name = `resume-app-mini-program`，和 backend 的 `resume-app-backend` 不冲突
- **删除 release**：`sentry-cli releases delete <release>`，小心，会清除关联的 source map

## Implementation files

| File | Role |
|---|---|
| `mini-program/utils/sentry.js` | `Sentry.init` + `beforeSend` PII strip |
| `mini-program/src/config.js` | 真 DSN / version / env（gitignored） |
| `mini-program/src/config.example.js` | 模板，committed |
| `mini-program/app.js` | 顶部 `require('./utils/sentry')` 早于 `App()` |
| `mini-program/scripts/upload-sourcemaps.js` | 手工上传 CLI |
| `.github/workflows/sentry-mp.yml` | CI 上传（默认 OFF） |
| `mini-program/tests/sentry-config.test.js` | 配置 sanity check |
