# 开发日志 — 2026-07-08（Phase 8+ Round 38）

> 阶段：8+ Round 38 — ADF hardening
> 前置：[2026-07-08-phase8-plus-round37.md](../devlog/2026-07-08-phase8-plus-round37.md)

## 目标

3 hardening 项：
B. 表维度慢查询 alert（按表告警）
C. OpenAPI 从 joi schema 自动生成
D. Auth cookie 化（admin web panel 准备）

## 最终结果

| 项 | 状态 |
|----|------|
| B SlowQueryByTable | ✅ 9 rules + 5 测 |
| C joi → OpenAPI | ✅ 10 type mapping + 3 schema 自动 + 10 测 |
| D cookie auth | ✅ httpOnly + WeChat 兼容 + 8 测 |
| **npm test 3x** | ✅ **373 / 368-370 pass / 2-4 fail / 1 skip** × 3 |

baseline 350 → 373（+23：B 5 + C 10 + D 8）。2-4 fail pre-existing authLockout + chaos race。

## 改动详情

### B — SlowQueryByTable

`backend/src/routes/metricsAlerts.js`（扩）：
- THRESHOLDS 加 `slowQueryPerTable: Number(process.env.ALERT_SLOW_QUERY_PER_TABLE_THRESHOLD || 20)`
- RULES 第 9 条：`SlowQueryByTable` (severity warning)
- evaluateRule 新 case：迭代 `db_slow_queries_total` 所有 `{operation, table}` label combos
  - `value` = 单 worst offender（max counter value）
  - `firing` = 任意 label-set ≥ threshold
  - `labels.offenders` = 完整 ≥ threshold 的 label-set 列表（含 operation/table/value）

`infra/prometheus/alerts.yml`：PromQL 规则同步
```yaml
- alert: SlowQueryByTable
  expr: max by (operation, table) (rate(db_slow_queries_total[5m])) > 0.2
  for: 5m
  labels: { severity: warning }
```

5 测全过：
1. `/rules` count 8→9 + SlowQueryByTable 存在
2. 全部 label-set < threshold → 不触发
3. 单 label-set ≥ 20 → 触发 + offenders 含该 combo
4. offenders 数组含多个 offenders
5. env `ALERT_SLOW_QUERY_PER_TABLE_THRESHOLD=10` 生效

### C — OpenAPI 从 Joi 自动生成

`backend/src/services/joiToOpenApi.js`（新，186 行）：
- `convertJoi(schema, {name})` → OpenAPI 3.0 schema
- 走 `schema.describe()` 不挖 `_flags` internals
- 10 类映射：string / number / boolean / array / object / alternatives / any / date / binary / integer (`rule.name === 'integer'`)
- 不可表达构造（Joi.ref 比较 / `allow ''`）静默 drop
- fallback `{}` + `console.warn` 兜底
- 双重标记：`x-source: "joi"` + `x-source-joi: <joiName>`

`backend/src/routes/openapi.js`（refactor）：
- 替换 `ResumeSaveRequest` / `JobCreateRequest` / `PromptUpdateRequest` 为 generated 版本
- 加 `info.x-generated-schemas: [...]` 数组
- 旁注 prompt PUT 加 requestBody 引用 `PromptUpdateRequest`
- `/openapi.json` 15,967 bytes valid JSON

10 测：8 unit + 1 round-trip + 1 integration（验证 x-source 标记）

### D — Auth Cookie 化

`backend/src/config/cookie.js`（新）：
```js
const COOKIE_CONFIG = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days, matches JWT_EXPIRES_IN
};
```

`backend/src/app.js`：`cookie-parser()` mount（after express.json）

`backend/src/middleware/auth.js`：
- `extractToken(req)`：header > cookie fallback
- `req.authVia = 'header' | 'cookie'` 标志传递
- cookie-mode → `requireCsrf` 额外校验 Origin 白名单（CORS_ALLOWED_ORIGINS）

`backend/src/routes/auth.js`：
- `/login`：`res.cookie('auth_token', access, COOKIE_CONFIG)` + refresh cookie
- `/refresh`：re-set cookie（新 access token）
- `/logout`：`res.clearCookie('auth_token', ...)` + refresh

`backend/src/middleware/csrf.js`：cookie-mode + 坏 Origin → 403（防 CSRF 攻击）

`backend/package.json`：`cookie-parser@^1.4.6`

8 测：
1. `/login` 设 httpOnly + sameSite=lax + maxAge
2. body 仍返 token（WeChat 兼容）
3. test env: secure=false
4. userAuth 接受 cookie 无 header
5. header 优先 cookie（两都有）
6. `/logout` 清双 cookie
7. `/refresh` 重设 cookie
8. cookie-mode 仍强制 CSRF

`docs-site/operations/auth-cookie.md`（新）：用法 + WeChat 兼容 + test vs prod secure flag

**Sample cookie**：
- Test/dev：`auth_token=<jwt>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`（no Secure）
- Prod：`auth_token=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000; Domain=.example.com`

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 373 | 369 | 3 | 1 |
| 2 | 373 | 368 | 4 | 1 |
| 3 | 373 | 370 | 2 | 1 |

baseline 350 → 373（+23）。pass 数 368-370 浮动（pre-existing authLockout + chaos race）；fail 数 2-4 浮动（同类）；均值稳。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | B value=单 worst, offenders=全 list | 一目 worst + 全 list 给 ops 排障 |
| 2 | B default 20 | 经验值；严于全局 50（per-table 更敏感） |
| 3 | C 走 describe() 不挖 _flags | joi 升级不破 |
| 4 | C fallback {} + warn | 不破 swagger UI |
| 5 | C paths 仍手写 | 包含 summary/responses/examples 复杂；自动生成价值低 |
| 6 | D header > cookie 优先级 | WeChat 永远走 header |
| 7 | D secure 仅 prod | local HTTP 测试可行 |
| 8 | D sameSite=lax 不 strict | admin 可能外链跳入 |
| 9 | D CSRF cookie-mode 额外 Origin 校验 | SameSite 已有，Origin 是双保险 |
| 10 | D body 仍返 token | WeChat 零修改 |

## 风险

| 风险 | 缓解 |
|------|------|
| B offenders 大列表 | 阈值控数量；>100 时截断 |
| C joi 升级 desribe() 改 | 锁 joi ^17；升级时 audit |
| C paths 漂移 | 仍手写；后续可生成 paths |
| D cookie XSS | httpOnly 必；XSS 仍可读 CSRF token 但调不了 API |
| D cookie CSRF | SameSite=lax + Origin 校验双保险 |
| D WeChat 旧调用方 | body 仍返 token；零迁移 |
| D Domain 设置错 | env COOKIE_DOMAIN 可控；默认 undefined |

## 已知 Follow-up

| # | 项 | 优先级 |
|---|----|--------|
| 1 | 多 pod alert dedupe 改 Redis pub/sub | 低 |
| 2 | C paths 也自动生成（route 文件扫描） | 中 |
| 3 | C joi2openapi 支持 `.example()` | 低 |
| 4 | D admin web panel（R39+ 接入） | 高 |
| 5 | D cookie rotation（refresh token 重用检测） | 中 |
| 6 | docs-site 自定义域名 | 中 |

## Commits

| SHA | msg |
|-----|-----|
| `b79e527` | docs(auth): cookie mode usage + WeChat backward compat |
| `b2d62ef` | test(auth): cookie auth suite (8 cases) |
| `78f5107` | feat(security): CSRF cookie-mode 额外 Origin 白名单校验 |
| `6c8493a` | feat(auth): userAuth accepts cookie as fallback to Bearer header |
| `2428fdb` | feat(auth): /login + /refresh set httpOnly auth_token cookie |
| `c3bd1fb` | feat(auth): cookie-parser middleware + COOKIE_CONFIG |
| `0739a8e` | test(openapi): joiToOpenApi converter suite (10 cases) |
| `9b1f4d6` | refactor(openapi): auto-gen schemas from joi (resume/job/prompt) |
| `b1dcf3e` | feat(openapi): joiToOpenApi converter (10 type mappings) |
| `43cd8bd` | feat(alerts): SlowQueryByTable rule (per-operation+table threshold) |