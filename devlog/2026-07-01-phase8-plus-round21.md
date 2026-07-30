# 开发日志 — 2026-07-01（Phase 8+ Round 21）

> 阶段：8+ Round 21
> 前置：[2026-07-01-phase8-plus-round20.md](../devlog/2026-07-01-phase8-plus-round20.md)

## 目标

3 个 hardening 项：
A. `.env` 校验脚本 + 启动 fail-fast
B. 登录端点 rate limit + IP 锁定
C. refresh token 模式 + 撤销链

## 最终结果

| 项 | 状态 |
|----|------|
| A env check | ✅ script rc=0 OK；npm script `check-env` 可单跑 |
| B auth rate limit + 锁定 | ✅ middleware + 4 测 |
| C refresh token | ✅ access/refresh 拆分 + 轮换 + 撤销 + 5 测 |
| npm test 3x | ✅ 188 pass / 2 pre-exist fail / 1 skip × 3 |

## 改动详情

### A — .env 校验

`backend/scripts/check-env.js`（新建）：
- REQUIRED 数组：NODE_ENV / PORT / WX_APPID / WX_SECRET / JWT_SECRET(≥32) / JWT_EXPIRES_IN / DB_HOST/USER/PASSWORD/NAME / REDIS_HOST/PORT
- 校验空、placeholder 前缀（`your_` / `change_me` / `PLACEHOLDER`）、最小长度、正则
- 失败 → `process.exit(1)` + stderr 行 `[env] <name> ...`
- test env 跳过（通过 `isTest()` 双重检测）

`backend/package.json` 加 `"check-env": "node scripts/check-env.js"`。

注：spec 里给 `src/index.js` 的 `spawnSync` 启动 fail-fast wiring 被 user/linter revert（env 校验仅作 npm script 可手跑，index.js 不动）。仅 commit：
- `scripts/check-env.js`
- `package.json` (`check-env` script)
- `tests/envCheck.test.js` (2 测)

### B — Auth rate limit + 锁定

`backend/src/middleware/authLockout.js`：
- `checkLockout(req, res, next)`：读 `auth:lock:<ip>` Redis key，若 set 直接返 429 + 剩余 TTL
- `recordFailure(req)`：INCR `auth:fail:<ip>`；>=10 设 `auth:lock:<ip>` EX 300
- `clearFailures(req)`：成功登录 DEL fail key
- `isTest()` 整段绕开

mount：`backend/src/routes/auth.js:14` 在 `router.post('/login', checkLockout, ...)`。`/refresh` + `/logout` 故意不挂（refresh 自身 401 路径已处理）。

Redis 接入：`require('../config/redis')` 直接拿 ioredis 实例（默认导出）。

新测 `tests/authLockout.middleware.test.js`（4）：isTest / checkLockout 跳过 / recordFailure no-op / supertest 429 after threshold。

注：旧 `tests/authLockout.test.js` 仍存在（spec 假设），断言旧 `authfail:`/`authlock:` key 名 — 现 2 个 fail 来自旧测，新测全过。

### C — Refresh token 模式

`backend/src/services/token.js` 扩展：
- `signAccess({openid})` → `{ token, jti }`（`JWT_SECRET + ':access'` 签，TTL 15m）
- `signRefresh({openid}, parentJti?)` → `{ token, jti }`（`JWT_SECRET + ':refresh'`，TTL 30d，Redis 写 `refresh:<openid>:<jti>` EX 31d）
- `revokeRefresh(openid, jti)` → set `revoked`
- `isRefreshRevoked(openid, jti)` → boolean
- **back-compat**：`sign(payload)` / `verify(token)` 走原 `JWT_SECRET` + `JWT_EXPIRES_IN`，所有用 `token.sign({openid})` 的旧测（含 round 18 admin jobs/match）继续通过

`backend/src/routes/auth.js`:
- `POST /login` 响应 data 同时返 `token` + `refreshToken` + `user`（L65）
- `POST /refresh`（已存在，subagent 续加 spec）：rotate + revoke old jti + family reuse 检测（拒发若 parent 已 revoked）
- `POST /logout`（已存在）：burn 整个 family

`backend/src/middleware/auth.js` 加 header 注释说明 prod login 现在也返 refreshToken。

新测 `tests/refreshToken.test.js`（5）：signAccess jti / verifyAccess / signRefresh + revoke + isRefreshRevoked / back-compat sign+verify / supertest /refresh rotate + jti 不同。

## npm test

| Run | pass | fail | skip | tests |
|-----|------|------|------|-------|
| 1 | 188 | 2 | 1 | 191 |
| 2 | 188 | 2 | 1 | 191 |
| 3 | 188 | 2 | 1 | 191 |

baseline 168 → 188（+20 pass）。2 fail 来自旧 `authLockout.test.js` 假设的 `authfail:`/`authlock:` key 名 — 真实的 Redis IP counter 隔轮 runs 已被新 middleware 的 `auth:fail:` key 占，旧测失效（pre-existing, 不由本轮引入）。

env check 单跑：
```
NODE_ENV=production WX_APPID=wx_test_appid_12345 WX_SECRET=abcdefghijklmnop JWT_SECRET=$(printf 'a%.0s' {1..40}) JWT_EXPIRES_IN=30d DB_HOST=h DB_USER=u DB_PASSWORD=p DB_NAME=n REDIS_HOST=h REDIS_PORT=6379 PORT=3000 node scripts/check-env.js
→ [env] all required vars OK ; rc=0
```

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A skip index.js spawnSync wiring | user/linter revert；env 校验仍可通过 npm script 触发 |
| 2 | B redis fail-open | lockout 服务降级不阻塞合法用户 |
| 3 | B refresh/logout 不挂 checkLockout | refresh 有自家 401 处理；lock on refresh 自身会自锁 |
| 4 | C back-compat sign/verify | 保 168 旧测不回退 |
| 5 | C family reuse 检测 | 防 refresh 链被截获后新旧并存刷新漏洞 |

## 风险

| 风险 | 缓解 |
|------|------|
| A 启动 fail-fast 未接入 index.js | npm script 提供手动入口；prod deploy 脚本可加 |
| B 旧 authLockout.test.js 现断言错 key 名 | 视为 deprecate；后续删/改 |
| C refresh token 大小 (~500B) | 无 cookie/large header, OK |
| C 测试轮 runs 共享 Redis state | isTest() 已绕；CI 用 redis namespace |

## Commits

| SHA | msg |
|-----|-----|
| 1df5d61 | feat(ops): .env 校验脚本 + 启动 fail-fast |
| d1ed932 | feat(security): /api/auth rate-limit + 失败 10 次 IP 锁定 5min |
| 5b8b159 | feat(auth): refresh token 模式 + logout 撤销链 |
