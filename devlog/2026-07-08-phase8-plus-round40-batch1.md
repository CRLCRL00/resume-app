# 开发日志 — 2026-07-08（Phase 8+ Round 40 Batch 1）

> 阶段：8+ Round 40 Batch 1 — ADF hardening
> 前置：[2026-07-08-phase8-plus-round39.md](../devlog/2026-07-08-phase8-plus-round39.md)

## 目标

3 hardening 项（重 R39 B + R34 chaos #12 + 新 F joi requestBody）：
B. Admin web panel（redo，dev-bypass 路线）
C. R34 chaos 4 隐患补第 4 项（redis-down warn log）
F. OpenAPI routeScanner 推断 requestBody from joi

## 最终结果

| 项 | 状态 |
|----|------|
| B admin panel redo | ✅ dev-bypass + 静态面板 + 5 页 + 8 测 |
| C chaos #12 | ✅ redis-down warn log + 1 测 |
| F joi requestBody | ✅ validate.js label + routeScanner $ref + 6 测 |
| **npm test 3x** | ✅ **402 / 399 pass / 2 fail / 1 skip** × 3 |

baseline 387 → 402（+15：B 8 + C 1 + F 6）。2 fail pre-existing authLockout。

## 改动详情

### B — Admin Web Panel（redo）

**路线调整**（vs R39-B killed 方案）：
- ❌ 不用独立 `/api/auth/admin-login` endpoint
- ✅ 复用 `/api/auth/login`，加 dev-bypass 短路：`code === 'dev-bypass'` + NODE_ENV != production
- ✅ 仍然验 `admins` 表 openid（不允许任意 openid）
- ✅ 调 `issueSession()` helper 共享 wechat path 同一 cookie/JWT/CSRF 行为
- ✅ 成功 log `security.admin.dev_bypass`
- ❌ 不新增 env var

`backend/src/routes/auth.js`：
```js
if (code === 'dev-bypass' && process.env.NODE_ENV !== 'production') {
  // 验 admins 表，set cookies 同正常 login
  const [rows] = await db.query('SELECT openid FROM admins WHERE openid = ?', [openid]);
  if (!rows.length) return 403;
  return issueSession(res, { userId, openid, loginMethod: 'dev-bypass' });
}
// fallthrough: 真实 wechat.code2session
```

`backend/src/app.js`：mount `express.static(adminPanelPath)` + SPA fallback before notFoundHandler。

`admin-panel/`（10 文件 / 433 行）：
- `index.html` — redirect to login
- `login.html` — form → `/api/auth/login` body `{code:'dev-bypass', openid:'dev-admin'}`
- `dashboard.html` — overview
- `jobs.html` — `/admin/jobs?q=`
- `audit.html` — `/admin/audit?action=`
- `queries.html` — `/admin/queries/slow`
- `two-factor.html` — `/admin/2fa/*`
- `css/admin.css` + `js/{api,auth}.js`

技术：Alpine.js 3 via CDN（无 build step）；`credentials: 'include'`；cookies only（无 localStorage）。

`docs-site/operations/admin-panel.md`（新）：file layout + dev login flow + page→API 表 + security notes + follow-ups。

8 测：
1. dev-bypass + NODE_ENV=test → 200 + cookie set
2. dev-bypass + NODE_ENV=production → 走 wechat path
3. dev-bypass + openid 不在 admins → 403
4. dev-bypass 不传 openid → 400
5. dev-bypass body 返 token 字段（WeChat 兼容）
6. /admin/login.html → 200 静态
7. /admin/dashboard.html → 200 静态
8. /admin/nonexistent.html → SPA fallback 200 login.html

### C — R34 Chaos #12（redis-down warn log）

R34 已修 3 项（health.js typeof check / auth.js fail-open warn / auth.js AppError 1501/1502）。
R40 补第 4 项：**`/ready` 返回 503 时 log warn 提示哪个组件挂**。

`backend/src/routes/health.js`：
```js
if (!ok) {
  if (!db.ok) logger.warn({ component: 'db', error: db.error }, 'health/ degraded');
  if (!rdb.ok) logger.warn({ component: 'redis', error: rdb.error }, 'health/ degraded');
}
```

`backend/tests/chaos/failOpen.test.js`（+1 测）：
- mock redis.ping throw → /ready 返回 503
- 验证 log 含 `component: 'redis'`

3 R34 修复全部确认在位（无漂移）：
- `health.js:56` `if (typeof redis.ping !== 'function')` ✓
- `auth.js:106` `logger.warn({ jti, err: e.message }, 'token revocation check failed; failing open')` ✓
- `auth.js:40/51/71` AppError 1501 (wechat) / 1502 (db) ✓

### F — OpenAPI requestBody 推断

`backend/src/middleware/validate.js`：
- 3 schema 加 `.label('ResumeSaveRequest'|'JobCreateRequest'|'PromptUpdateRequest')`
- `validateBody` 返回的 mw 上挂 `__joiSchema`（ref）+ `__joiSchemaLabel`（从 `_flags.label` 取）
- backward-compat：caller 无感；extra props 只 scanner 读

`backend/src/services/routeScanner.js`：
- middleware entries 从 `{name}` 升级为 `{name, requestSchema?, requestSchemaName?}` 经新 `describeMw()`
- `routesToOpenApi` 检测 `requestSchemaName` → emit：
  ```js
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/{Name}' } } }
  }
  ```
- label 缺失 graceful skip（不 emit requestBody）

`backend/tests/routeScanner-requestBody.test.js`（新，6 测）：
1. 含 validateBody middleware 的 POST 路由 → requestBody $ref
2. 无 validateBody → 不 emit requestBody
3. label 缺失 → 不 emit requestBody
4. PUT 路由同样推断
5. hand-written 路径优先（不覆盖）
6. integration：GET /api/docs/openapi.json 含 requestBody ref

**Live sample**（手写 spec + 自动 scanner 合并后）：
```
POST /api/admin/jobs         → $ref: #/components/schemas/JobCreateRequest
PUT  /api/admin/jobs/{id}    → $ref: #/components/schemas/JobCreateRequest
PUT  /api/admin/prompts/{code} → $ref: #/components/schemas/PromptUpdateRequest
```

`/api/resume/save` 用 inline `resumeSchema.validate()` 而非 `validateBody` middleware，其 requestBody 仍来自 hand-written OpenAPI path — 未变。

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 402 | 399 | 2 | 1 |
| 2 | 402 | 399 | 2 | 1 |
| 3 | 402 | 399 | 2 | 1 |

baseline 387 → 402（+15：B 8 + C 1 + F 6）。0 新 fail。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | B 复用 /login + dev-bypass 而非新 endpoint | R39-B killed 方案避免；少一个攻击面 |
| 2 | B dev-bypass 仍验 admins 表 | 防止"任意 openid 直登 admin" |
| 3 | B 提取 issueSession() helper | dev/wechat path 共享 cookie/JWT/CSRF 行为 |
| 4 | B Alpine.js via CDN | 无 build step；admin panel 简单 |
| 5 | B cookies only + credentials:'include' | admin 操作 XSS 风险面 |
| 6 | C redis-down warn log 含 error 字段 | ops 一眼看到错因 |
| 7 | F 走 joi `.label()` 而非 reflection | joi 官方推荐；稳定 |
| 8 | F 暴露 `__joiSchema` ref + label | scanner 不挖 _flags internals |
| 9 | F label 缺失 graceful skip | 不破 swagger UI；向后兼容老 schema |

## 风险

| 风险 | 缓解 |
|------|------|
| B dev-bypass 误开在 prod | NODE_ENV==='production' 强校验；CI/CD 必须设 |
| B admin openid 泄 → 任意电脑可登 | 仅 dev-bypass；prod 仍需 wechat 扫码 |
| C warn log 高频（redis 长时间挂） | 5s 一次 rate limit（health.js 已实现） |
| F joi 升级 `_flags.label` 改 | 锁 joi ^17；写 `__joiSchemaLabel` null fallback |
| F requestBody 误报（手写冲突） | `{...auto, ...manual}` manual wins |

## 已知 Follow-up

| # | 项 | 优先级 |
|---|----|--------|
| 1 | 多 pod alert dedupe 改 Redis pub/sub | 低 |
| 2 | docs-site 自定义域名 | 中 |
| 3 | Sentry source map for mini-program | 中 |
| 4 | WeChat MP 审核 + 体验版发布 | 中 |
| 5 | admin panel: 2FA 强制启用 + device fingerprint | 低 |

## Commits

| SHA | msg |
|-----|-----|
| `fe43fee` | test(openapi): requestBody 推断测试 6 cases |
| `5e02f4c` | feat(openapi): routeScanner 推断 requestBody 从 validateBody |
| `59a7ec0` | refactor(validate): 加 .label() + 暴露 __joiSchema 给 scanner |
| `e174a4b` | docs(admin): admin panel usage + dev login flow |
| `5ea1b8b` | feat(admin): static panel at /admin/* (login + 5 pages + Alpine.js) |
| `05d0316` | feat(auth): /login dev-bypass for admin panel (NODE_ENV != production) |
| `8713633` | fix(health): log warn when /ready returns 503 due to redis down |

> R40 还有 Batch 2（D WeChat MP + E Sentry + G docs-site domain）+ Batch 3（H 幂等键 + A 多 pod dedupe）待派。
