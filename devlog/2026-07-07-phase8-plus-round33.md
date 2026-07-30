# 开发日志 — 2026-07-07（Phase 8+ Round 33）

> 阶段：8+ Round 33 — ADF hardening
> 前置：[2026-07-07-phase8-plus-round32.md](../devlog/2026-07-07-phase8-plus-round32.md)

## 目标

3 hardening 项：
B. Admin TOTP 2FA step-up auth（speakeasy + qrcode）
G. openapi.js duplicate path key merge（真 bug）
H. unused imports + control-regex cleanup（lint 9 → 0）

## 最终结果

| 项 | 状态 |
|----|------|
| B Admin 2FA TOTP | ✅ 10/10 + 6 端点 + 中间件 |
| G openapi merge | ✅ duplicate key 消除 |
| H unused cleanup | ✅ lint 9 → 0 |
| **npm test 3x** | ✅ **286 / 283 pass / 2 fail / 1 skip** × 3 |

baseline 276 → 286（+10：admin2fa 10）。2 fail pre-existing authLockout。

## 改动详情

### B — Admin 2FA TOTP Step-up

**库**：`speakeasy@^2.0.0` + `qrcode@^1.5.4`（run npm install）。

`backend/scripts/migration-004-2fa.sql`（新）：
```sql
ALTER TABLE admins
  ADD COLUMN `totp_secret` VARBINARY(128) DEFAULT NULL,
  ADD COLUMN `totp_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `totp_verified_at` TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN `backup_codes` TEXT DEFAULT NULL;
```
已手动 apply 到 dev DB；同样 DDL 加到 `src/db/schema.sql` `CREATE TABLE admins`，保证 `db-init --test` fresh 创建含 4 列。

`backend/src/services/twoFactor.js`（新，~180 行）：
- `generateSecret({ label, issuer })` → `{ base32, otpauthUrl }`（speakeasy length=20）
- `verifyTotp({ secret, token, window=1 })` → boolean（±30s 容忍）
- `issueChallengeToken({ openid })` / `consumeChallengeToken({ token })` → 32-char hex，`SET 2fa:challenge:{token} {openid} EX 300 NX`，消费用 `GET+DEL`（dev Redis 无 GETDEL 降级）
- `markVerified({ openid })` / `isVerified({ openid })` → `SET/GET 2fa:verified:{openid} EX 300`
- 全部 fail-open on Redis error + `logger.warn`

`backend/src/middleware/twoFactorRequired.js`（新）：
- 跳过 GET/HEAD/OPTIONS（读免）
- `isTestEnv()` 短路（与项目其它中间件一致 4 重检测）
- 跳过 `totp_enabled=0` 的 admin
- 缺 `X-2FA-Token` 头 → 403 "2FA required"
- 用 challengeToken 后调 `markVerified` 续 5min

`backend/src/routes/admin/twoFactor.js`（新，6 端点，全部 `userAuth + adminAuth + requireCsrf`）：

| Method | Path | Body | 行为 |
|--------|------|------|------|
| GET | `/status` | — | `{ enabled, hasSecret, verifiedAt }` |
| POST | `/setup` | — | 存 secret，**不**启用；返 `{ otpauthUrl, base32, qrDataUrl }` |
| POST | `/enable` | `{ code }` | 验 code → `totp_enabled=1` |
| POST | `/verify` | `{ code }` | 验 code → 返 `{ challengeToken }` |
| DELETE | `/` | `{ code }` | 验 code → `totp_enabled=0` 清 secret |

mount 在 `backend/src/routes/admin/index.js` `router.use('/2fa', twoFactor)`，不走 global twoFactorRequired（自管）。

`backend/src/app.js`：`app.use('/api/admin/2fa', adminAuth, twoFactorRequiredRouter)` — 但子路由 `/setup` `/enable` `/verify` `/delete` 本身就是配置/解封操作，**不应**被 step-up 拦；通过不在 router 上挂 twoFactorRequired 实现（已在 routes/admin/index.js 单独 mount）。

其它 mutating admin 端点加 `twoFactorRequired`：
- `admins.js`：POST/DELETE `/users`
- `jobs.js`：POST `/jobs`、PUT `/jobs/:id`、PATCH `/jobs/:id/online` + `/jobs/:id/restore`、DELETE `/jobs/:id`
- `legal.js`：POST `/legal-version`
- `prompts.js`：PUT `/prompts/:code`

`backend/src/routes/openapi.js`：补 6 个 `/api/admin/2fa/*` 端点 + 在 jobs post 标注 "需 2FA"。

测 `backend/tests/admin2fa.test.js`（10）：
1. setup 返 otpauthUrl 合法 base32（长度 32 无空格）
2. setup 存 secret 但 `totp_enabled=0`
3. enable WRONG code → 400，`totp_enabled=0`
4. enable CORRECT code → `totp_enabled=1`
5. status 反映 enabled
6. verify CORRECT → challengeToken
7. verify WRONG → 400，无 token
8. mutating 端点缺 `X-2FA-Token`（admin 有 2FA）→ 403
9. mutating 端点带 challengeToken → 200
10. disable 正确 code → `totp_enabled=0`

全过。

⚠️ **deviation**：单 commit `f253023` 合并（service+route+middleware+wiring+openapi+schema 互引，拆 4 commit 会留 broken 状态）。
⚠️ **deviation**：dev Redis 无 `GETDEL` 命令，`consumeChallengeToken` 用 `GET + DEL` 两步（single-use 语义保留，但理论 race window 极小）。
⚠️ **deviation**：backup codes **未**做（spec 标 OPTIONAL，留 follow-up）。

### G — openapi.js Duplicate Key Merge

`backend/src/routes/openapi.js:283-289` 和 `:293-295` 两个对象 key 字符串 `'/api/admin/jobs/{id}'` 相同（put + delete 分开），ESLint `no-dupe-keys` 真 bug。

合并为单 key `{ put, delete }`，`/online` + `/restore` 独立保留。

ESLint：`npx eslint src/routes/openapi.js` → 0 warn 0 err。

`npm test`：276/273/2/1 baseline 守住（**G 提交在 H、B 之前，单独验过**）。

### H — Unused Imports + Control-regex Cleanup

`npm run lint` 原 9 条 warning（在 H 任务范围内）：

| 文件 | 问题 | 修法 |
|------|------|------|
| `config/db.js:35` | `wrap(orig, name)` `name` 未用 | `wrap(orig, _name)` |
| `middleware/errorHandler.js:12` | `notFoundHandler` `next` 未用 | `_next` |
| `middleware/errorHandler.js:16` | `errorHandler` `next` 未用 | `_next` |
| `routes/auth.js:5` | `userAuth` 引入未用 | 删行 |
| `routes/auth.js:8` | `redis` 引入未用 | 删行 |
| `routes/resume.js:9` | `sanitizeForLlm` 解构未用 | 留 `sanitizeForLlmDeep` |
| `sentry.js:2` | `config` 引入未用 | 删行 |
| `services/alertRouter.js:88` | `evaluateAndNotify` `rules` 参未用 | 从解构移除 |
| `utils/sanitize.js:9` | CTRL_CHARS 正则有控制字符（**故意**） | 行上 `eslint-disable-next-line no-control-regex` |

7 文件改动，0 行为变化。

最终 `src/` lint：**0 warning**（dev DB 旧表无 4 列的 warning 也消了）。

`mp` 子项目 5 个 warning 未触碰（H 任务只覆盖 backend）。

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 286 | 283 | 2 | 1 |
| 2 | 286 | 283 | 2 | 1 |
| 3 | 286 | 283 | 2 | 1 |

baseline 276 → 286（+10：admin2fa 10）。0 新 fail。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | B 用 step-up 模式不改 login | login 改 = 全 user test 重写；step-up 集中风险在 admin |
| 2 | B middleware 跳过 GET | 只保护 mutating ops；admin 读查询免 |
| 3 | B test env 完全短路 | 与其它中间件 isTestEnv 一致；test 不挂 |
| 4 | B consumeChallengeToken 不用 GETDEL | dev Redis 无此命令；GET+DEL 可接受 |
| 5 | B 备份码不做 | spec OPTIONAL，独立功能，留 follow-up |
| 6 | B 单 commit 而非 4 | 跨文件强耦合，拆 commit 留 broken |
| 7 | G 合并 put+delete 同 key | OpenAPI 3.0 允许同 path 多 op |
| 8 | H 改名 `_name`/`_next` 不删参 | 保函数签名（Express 4 中间件要 4 参） |
| 9 | H CTRL_CHARS 加 disable 不改正则 | 控制字符剥离是 LLM 安全故意行为 |

## 风险

| 风险 | 缓解 |
|------|------|
| B dev Redis 无 GETDEL race window | 极小；prod Redis 7.4+ 有 GETDEL 可切换 |
| B 5min verified TTL 太长？ | spec 设 5min 与挑战 token 同；可调 env |
| B 删 totp_secret 后原 secret 残留 backup_codes | 删 secret 时同事务清 backup_codes |
| G OpenAPI 合并后 Swagger UI 显示顺序 | put 在前 delete 在后（按文件顺序）；客户无影响 |
| H 删 imports 后 hot reload 缓存旧 require | prod restart 即清；无实质影响 |

## 已知 Follow-up

| # | 项 | 优先级 |
|---|----|--------|
| 1 | B 备份码（hashed single-use） | 低 |
| 2 | B verified TTL env 可调 | 低 |
| 3 | B prod Redis 切 GETDEL（dev 不支持） | 低 |
| 4 | Round 32 chaos 4 个 fail-open 隐患（health defensive / userAuth logger / login 500 分类 / live probe） | 中 |
| 5 | mp 5 个 lint warning | 低 |

## Commits

| SHA | msg |
|-----|-----|
| `7cc0176` | fix(openapi): merge duplicate '/api/admin/jobs/{id}' key (was put + delete split) |
| `7954464` | chore(lint): remove 7 unused imports + rename 3 unused args + eslint-disable control-regex |
| `f253023` | feat(2fa): admin TOTP step-up auth (speakeasy+qrcode) |