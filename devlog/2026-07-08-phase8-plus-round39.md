# 开发日志 — 2026-07-08（Phase 8+ Round 39）

> 阶段：8+ Round 39 — ADF hardening
> 前置：[2026-07-08-phase8-plus-round38.md](../devlog/2026-07-08-phase8-plus-round38.md)

## 目标

3 hardening 项：
B. Admin web panel（cookie 接入 + SSR）
C. OpenAPI paths 自动生成（路由扫描）
D. Cookie rotation + theft detect

## 最终结果

| 项 | 状态 |
|----|------|
| B admin panel | ❌ user kill（孤儿文件已 revert） |
| C OpenAPI paths | ✅ routeScanner + 8 测 |
| D cookie rotation | ✅ theft detect + 6 测 |
| **npm test 3x** | ✅ **387 / 384 pass / 2 fail / 1 skip** × 3 |

baseline 373 → 387（+14：C 8 + D 6）。2 fail pre-existing authLockout。

## ⚠️ 子 agent 异常

3 个 subagent 中途异常：
- **B** 被 user 主动 kill。partial work（app.js admin static / auth.js admin-login / 2 test files）全部 revert。
- **C** process exited（in-process state lost）。但 file system 已写出 routeScanner.js / routeScanner.test.js / openapi.js 改动，实现完整 → commit。
- **D** watchdog timeout stall。staged 改动（auth.js / token.js）+ 1 test + 1 doc 完整 → commit。

B 的 admin panel 路径留作 follow-up（user 重新派发）。

## 改动详情

### C — OpenAPI Paths Auto-gen

`backend/src/services/routeScanner.js`（新）：
- `scanRoutes(app)`：walk `app._router.stack` 递归，emit `{method, path, middlewares}` 数组
- `routesToOpenApi(routes)`：Express `:id` → OpenAPI `{id}` + path 参数
- 跳 `/api/internal/*`（默认）+ `/api/docs/*` + `/api/health/*`
- 0 dep（自写 walker）

`backend/src/routes/openapi.js`（改）：
- 拆 `paths: {}` + `handWrittenPaths.paths = {...}`
- **lazy build**：`router.get('/openapi.json', (req, res) => { buildMergedPaths(req.app); ... })`
- 原因：`openapi.js` 在 `app.js` 底部 require，**模块加载时**不能调 `createApp()`（circular）；handler 在 app 完全构造后跑，扫 `req.app` 安全
- merge 顺序：`{ ...autoPaths, ...manual }` — **hand-written wins**
- `info.x-path-count = { auto: N, manual: M }` 给 ops

8 测覆盖：count ≥ 25 routes / method lowercase / path start /api/ / middlewares array / `:id` → `{id}` / path param / merge 策略 / integration `GET /api/docs/openapi.json`

### D — Cookie Refresh Theft Detection

`backend/src/services/token.js`（扩）：
- `checkCookieTheft({ oldRefreshJti, currentRefreshJti })` → boolean
- 检查 `oldRefreshJti` 是否在 Redis blacklist

`backend/src/middleware/auth.js`（改）：
- import `decode`, `burnFamily` + `securityLog`
- `userAuth` 在 cookie-mode 且 `req.cookies.refresh_token` 存在时 → 调 `checkCookieTheftRefresh(req)`
- 命中 theft：
  1. `burnFamily(family)`
  2. `res.clearCookie('auth_token', 'refresh_token')`
  3. `securityLog.recordSync('cookie_theft', ...)`
  4. 直接 401 JSON（不走 errorHandler 避免 setHeader 顺序坑）
- 加 `req.sessionBumpedAt` 时间戳供 ops

`backend/tests/auth-cookie-rotation.test.js`（新，6 测）：
1. cookie-mode + 无 header → userAuth 通过
2. refresh 后用旧 refresh cookie → 401
3. refresh 后用新 cookie → 200
4. logout 后用旧 cookie → 401
5. 多次 refresh 后用远古 cookie → 401
6. header-mode (WeChat) 不触发 cookie theft 检测

`docs-site/operations/auth-cookie.md`（扩）：加 "Cookie theft detection (R40)" 段 + 6 测的引用说明

### B — Admin Web Panel（reverted）

subagent kill 后 partial work：
- `backend/src/app.js` 加 admin-panel static serving（指向不存在的 `admin-panel/` 目录）
- `backend/src/routes/auth.js` 加 `/api/auth/admin-login` dev endpoint
- 2 test files (`admin-panel-static.test.js`, `auth-admin-dev.test.js`)

全部 revert via `git checkout -- backend/src/app.js backend/src/routes/auth.js` + `rm` test files。

User 想做 admin panel 时另派 round 重启。

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 387 | 384 | 2 | 1 |
| 2 | 387 | 384 | 2 | 1 |
| 3 | 387 | 384 | 2 | 1 |

baseline 373 → 387（+14）。0 新 fail。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | C lazy build paths on first request | openapi.js 在 app.js 底部 require；modelload 不能 createApp |
| 2 | C hand-written wins | 手写有 summary/responses/examples；自动生成只兜底 |
| 3 | C 0 dep 自写 walker | express-list-endpoints 不必要；walker ~80 行 |
| 4 | C 跳 /api/internal 默认 | 服务端内部接口不进公开 docs |
| 5 | D theft 触发 → 401 直接写 | 避免 errorHandler setHeader 顺序坑 |
| 6 | D 仅 cookie-mode 触发 | WeChat header-mode 不动 |
| 7 | D 改 /logout 改 docs（不动 code） | 当前 /logout 已 revoke JWT；无需改 |
| 8 | B revert 完整 | admin panel 是大功能；user 决定何时重派 |

## 风险

| 风险 | 缓解 |
|------|------|
| C walker 依赖 Express internals | 锁 express ^4.x；升级时 audit |
| C auto paths 误覆盖 hand-written | `{...auto, ...manual}` manual 后展 |
| D theft 误报（refresh race） | 仅 refresh jti 已在 blacklist 才触发；新 jti 永远 OK |
| D burnFamily 失败 | catch + warn log；不影响主流程 |
| B revert 干净 | git checkout + rm test files；0 残留 |

## 已知 Follow-up

| # | 项 | 优先级 |
|---|----|--------|
| 1 | 多 pod alert dedupe 改 Redis pub/sub | 低 |
| 2 | B admin web panel 重派（user 决定） | 高 |
| 3 | C paths 自动生成 joi requestBody 推断 | 中 |
| 4 | docs-site 自定义域名 | 中 |
| 5 | Round 32 chaos 4 fail-open 隐患 #1 #2 | 中 |

## Commits

| SHA | msg |
|-----|-----|
| `70c8cbd` | feat(openapi): auto-scan Express routes for OpenAPI paths (hand-written wins) |
| `9024863` | feat(security): cookie refresh theft detection (rotation + revoke + burn family) |

> 注：devlog 覆盖 R39 原计划 3 项中的 2 项（B 被 user kill）。B admin panel 留 follow-up。