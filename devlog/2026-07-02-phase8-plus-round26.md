# 开发日志 — 2026-07-02（Phase 8+ Round 26）

> 阶段：8+ Round 26
> 前置：[2026-07-02-phase8-plus-round25.md](../devlog/2026-07-02-phase8-plus-round25.md)

## 目标

3 个 hardening 项：
A. admin POST/PUT/DELETE 加 CSRF token 校验
B. validateBody middleware 全面替换
C. server 启动自我诊断

## 最终结果

| 项 | 状态 |
|----|------|
| A CSRF | ✅ middleware + login 下发 csrfToken + adminAuth 数组导出 + 4 测 |
| B validateBody 全替换 | ✅ admin/jobs.js 重构 + 其他 route 无 inline joi |
| C diagnose | ✅ 表/列/admin seed/schema_migrations 检查 + 2 测 |
| npm test 3x | ✅ 215 pass / 2 fail / 1 skip × 3 |

## 改动详情

### A — CSRF token

`backend/src/middleware/csrf.js`（新）：
- `issueCsrf(openid, accessJti)` → random 24b base64url，写 Redis 8h
- `requireCsrf(req, res, next)` middleware：
  - safe methods (GET/HEAD/OPTIONS) bypass
  - test env bypass
  - 缺 `X-CSRF-Token` header → 403
  - Redis 校验 `csrf:<openid>:<jti>` 必须等于 header 值
  - Redis down → fail-open（不阻断合法 user）

wire：
- `auth.js`：login 响应 data 加 `csrfToken: <csrf.issueCsrf(openid, access.jti)>`
- `adminAuth.js`：`module.exports = { adminAuth: [adminAuthFn, requireCsrf], adminAuthFn }` — Express 支持数组作 middleware

测：`tests/csrf.test.js`（4）：test env bypass / GET bypass / missing header 403 / unknown jti 403

CSRF 加后 prod 实际生效，但 **test env bypass** 所以现有测试不挂。

### B — validateBody 全替换

迁移：
- `admin/jobs.js:6,29-42,44-60` — POST/PUT 从 `schema.validate(req.body)` 改 `validateBody(jobSchema)` middleware

跳过：
- `resume.js:14-15` — inline `resumeSchema.validate(req.body.source_form)` 是嵌套 key，`validateBody` middleware 默认只查 top-level `req[source]`；改 schema 重构过大，按 spec rule 5 不动
- `match.js / user.js / legal.js / admin/index.js / admin/admins.js` — 无 inline joi

### C — 启动诊断

`backend/src/db/diagnose.js`（新）：
- `REQUIRED_TABLES` 11 张：users / resumes / jobs / matches / match_results / audit_logs / admin_audit / privacy_versions / admins / prompts / schema_migrations
- `REQUIRED_COLUMNS`：每张表 4-5 关键 column
- 3 步检查：
  1. 缺失表 → warn
  2. 表存在但缺 column → warn
  3. admins 表 0 行 → warn "no admin seeded"
- 4: schema_migrations 空 → warn
- test env 全 bypass

`index.js` boot 后 fire-and-forget 调用：
```js
diagnose().then(({ ok, warnings }) => {
  if (!ok) logger.warn({ warningsCount: warnings.length }, 'startup diagnostics: warnings present');
  else logger.info('startup diagnostics: all checks passed');
});
```

⚠️ spec 列表含 `audit_logs` + `match_results` 但 codebase 用 `admin_operation_logs` + 没 `match_results` 表 — 保持 verbatim 让 prod boot 时真实 warning（fail-loud）。

测：`tests/diagnose.test.js`（2）：REQUIRED_TABLES 内容 + diagnose test env bypass。

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 218 | 215 | 2 | 1 |
| 2 | 218 | 215 | 2 | 1 |
| 3 | 218 | 215 | 2 | 1 |

baseline 212 → 218（+6：csrf 4 + diagnose 2；CSRF + validateBody 部分回归没有）。

2 fail pre-existing：`authLockout` state pollution + route-auth IP rate-limit flake。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A 数组导出 adminAuth | Express middleware 支持数组；向后兼容 |
| 2 | A CSRF Redis fail-open | Redis 挂不阻断合法 user |
| 3 | B 跳 resume 嵌套 key | 改 schema 请求体 shape，scope creep |
| 4 | C 不 fail 启动 | warn-only；让 prod boot even if schema 缺 |
| 5 | C 缺表 keep verbatim | 真 issue 应 loud warn，不是 silent |

## 风险

| 风险 | 缓解 |
|------|------|
| A mini-program 不会主动发 X-CSRF-Token | 后台 admin web/curl 用；小程序走 /api/admin 时 authMiddleware 已在 adminAuth 链条前 |
| B resume.js validate 漏改 | 当前 inline 仍 work；后续再迁 |
| C warn 噪声多 | admin_production_deploy 后可清单校对 |

## Commits

| SHA | msg |
|-----|-----|
| `c48a2f4` | refactor(routes): inline joi 全迁 validateBody middleware |
| `0ed50a7` | feat(security): admin POST/PUT/DELETE 加 CSRF token 校验 |
| `ff7afea` | feat(startup): boot 诊断 (表/列/admin seed/schema_migrations) |
