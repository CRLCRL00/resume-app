# Sentry Integration (Backend)

## Why Sentry

Sentry 收集后端运行时异常（5xx）和未捕获的 Node 异常，并把堆栈、请求上下文（路由 / 方法 / 用户 / requestId）聚合到 dashboard。对生产环境的故障定位（尤其是偶发 5xx、内存泄漏、依赖超时）相比纯日志检索更快。

它**不是**通用 logging 替代品——pino 仍负责结构化访问日志，Sentry 只关注异常和错误事件。

## How to enable

Set `SENTRY_DSN` in `.env` (or k8s secret / 部署 env):

```env
SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
```

不需要任何代码改动。`backend/src/sentry.js` 的 `initSentry()` 在 `backend/src/index.js` 启动时调用：

- `SENTRY_DSN` 未设置 → `initSentry()` 返回 false，整个模块 no-op（不引入 Sentry SDK、不改事件流、不影响 request latency）
- `SENTRY_DSN` 设置 → `Sentry.init(...)` 触发，tracesSampleRate 在 `production` 为 `0.1`，其他环境为 `0.0`（避免噪音和额外费用）

环境变量矩阵：

| Env var | Default | Effect |
|---|---|---|
| `SENTRY_DSN` | `''` | 未设置 → 关闭 Sentry（no-op） |
| `NODE_ENV` | `development` | 仅 `production` 启用 traces 采样（10%） |
| `npm_package_version` | (auto) | 设置 Sentry `release` tag |

## What gets captured

Sentry 在以下时机自动上报：

1. **`uncaughtException`** — Node 进程级未捕获异常
2. **`unhandledRejection`** — Promise 未捕获 reject（包装为 Error 再上报）
3. **Express 5xx** — `Sentry.setupExpressErrorHandler(app)` 捕获所有通过 error middleware 的非 `AppError` 异常
4. **Error middleware 增强** — `errorHandler` 在返回 500 时，把 `req.user.userId`、`requestId`、route/method 作为 tag/user 附加到 event

### Context attached per event

| Field | Source | Example |
|---|---|---|
| `environment` | `NODE_ENV` | `production` |
| `release` | `process.env.npm_package_version` | `0.1.0` |
| `tags.route` | `req.baseUrl + req.route.path` | `/api/resume/generate` |
| `tags.method` | `req.method` | `POST` |
| `tags.requestId` | `req.requestId` | UUID v4 |
| `user.id` | `req.user.userId`（如已登录） | `42` |

## What gets stripped (`beforeSend`)

上传到 Sentry 前过滤敏感 header（即使 Sentry 默认会过滤请求 body，我们显式再 strip 一遍 header）：

- `authorization` — Bearer / JWT 凭证
- `cookie` — session cookie
- `x-csrf-token` — admin CSRF token

```js
beforeSend(event) {
  if (event.request && event.request.headers) {
    delete event.request.headers.authorization;
    delete event.request.headers.cookie;
    delete event.request.headers['x-csrf-token'];
  }
  return event;
}
```

**注意：** Sentry 默认还会 strip request body / query 中的密码字段（`password`、`passwd`、`secret` 等）。如有自定义敏感字段需扩展 `beforeSend`。

## How to test integration

部署后（或 staging），用以下 endpoint 触发一条手动消息：

```bash
curl -X POST https://<host>/api/internal/sentry-debug \
  -H 'Content-Type: application/json' \
  -d '{"message":"manual integration ping","level":"warning"}'
```

Response:

```json
{ "code": 0, "data": { "sentry": true, "eventId": "abc123...", "level": "warning", "message": "manual integration ping" } }
```

返回的 `eventId` 可以在 Sentry dashboard 搜索框粘贴定位。

### Disabled state

未配置 `SENTRY_DSN` 时调用该 endpoint：

```json
HTTP 503
{ "code": 0, "data": { "sentry": false, "hint": "SENTRY_DSN not configured" } }
```

返回 503 是显式信号：调用方应当知道 Sentry 没启用，不要再重试。

## Implementation files

| File | Role |
|---|---|
| `src/sentry.js` | `initSentry` / `isInitialized` / `captureMessage` / `captureException` + test 注入点 `setTestCapture` |
| `src/config/index.js` | 读取 `SENTRY_DSN` env |
| `src/index.js` | `initSentry()` + `setupExpressErrorHandler(app)` + `uncaughtException` / `unhandledRejection` 上报 |
| `src/middleware/errorHandler.js` | 500 → `Sentry.captureException` 带 tag/user |
| `src/routes/sentryDebug.js` | `POST /api/internal/sentry-debug` |
| `src/app.js` | mount sentryDebug router 在 `/api/internal` |
| `tests/sentry.test.js` | 4 个测试覆盖 init、503 路径、200 路径（用 test capture stub） |

## Testing philosophy

`@sentry/node` 的真实网络事件不会被测试触发。`sentry.js` 暴露 `setTestCapture(fn)` 测试钩子，把 `captureMessage` / `captureException` 重定向到一个 stub，记录调用参数。测试结束后用 `setTestCapture(null)` 清理。生产代码路径永远不会读取这个 hook（它是 module 内的 `testCapture` 变量，默认 `null`）。

## Cost / sample rate

- `tracesSampleRate = 0.1` (production) — 10% 事务追踪；非 production 为 0
- Error events (captureException / captureMessage) 永远上报，不抽样
- Quota 超限会被 Sentry 静默 drop；监控 quota 上限在 Sentry dashboard > Settings > Stats

## Operational notes

- **重启应用**：Sentry SDK 在内存里维护 client，DSN 改变需要重启进程（不热加载）
- **本地开发**：默认不启用采样；如想本地试，发一个 debug 事件可在 `.env` 设 `SENTRY_DSN`，然后 `POST /api/internal/sentry-debug`
- **依赖升级**：`@sentry/node` 已加入 `package.json` 的 `dependencies`，升级时按 semver major 检查 API（v8 → v10 之间 `setupExpressErrorHandler` 已可用）