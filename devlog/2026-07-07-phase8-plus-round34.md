# 开发日志 — 2026-07-07（Phase 8+ Round 34）

> 阶段：8+ Round 34 — ADF hardening
> 前置：[2026-07-07-phase8-plus-round33.md](../devlog/2026-07-07-phase8-plus-round33.md)

## 目标

3 hardening 项：
C. 性能基准（autocannon + p95/p99）
D. Round 32 chaos 3 隐患 fix（openapi 已在 R33 修）
G. mini-program 5 lint warn + 死码扫

## 最终结果

| 项 | 状态 |
|----|------|
| C perf bench | ✅ 4 endpoints / 0 err / p99 ≪ 2000ms |
| D chaos fix | ✅ 3 commit + 4 new chaos tests |
| G mp cleanup | ✅ 5 warn → 0 + 0 死码 |
| **npm test 3x** | ✅ **290 / 287 pass / 2 fail / 1 skip** × 3 |

baseline 286 → 290（+4：D chaos 4）。2 fail pre-existing authLockout。

## 改动详情

### C — 性能基准

`backend/scripts/perf-bench.js`（新，204 行）+ `docs/perf-bench.md`：
- 自包含 Node 脚本：boot app + mock wechat/llm + pre-seed bench user/admin + 4 endpoint × 10s autocannon
- `autocannon@^7.15.0` devDep
- npm scripts：`perf:bench`、`perf:bench:ci`（threshold 1500ms / 5s）
- 退出码：p99 < 阈值 0，超 1

**绕过限流（关键）**：require.cache 注入 stub 三个限流模块：
- `services/rateLimit.check`（路由内 4/60s）
- `middleware/slidingRateLimit.slidingRateLimitMiddleware`（app.js 10/60s）
- `middleware/rateLimit.{resumeLimiter, matchLimiter}`（express-rate-limit 30/10min IP 维度）
- 不绕 → 5 并发瞬间 429-spam，测的是限流器非路由

**实测样本**（Node 22, MySQL localhost, mock LLM）：
```
GET  /api/health        p50:23  p95:33  p99:36  max:58   2114 req/s, 0 err
POST /api/resume/save   p50:207 p95:275 p99:279 max:282  96 req/s,   0 err
POST /api/resume/generate p50:2 p95:3   p99:4   max:120  2170 req/s, 0 err (mock)
POST /api/match         p50:4  p95:6   p99:7   max:10   1019 req/s, 0 err (mock)
```
全 4 端点 0 err。p99 远低于 2000ms 阈值。`max` 偶发 120ms 是 V8 JIT 预热。

⚠️ **caveat**：
- mock LLM，**不含真实 DeepSeek 延迟**（测 DB/校验/响应整形）
- 单 instance，prod PM2 N worker 吞吐 ×N
- autocannon 单 IP，**必须**绕过 IP 限流
- 首 ~50 reqs 显著慢（手动比较 baseline 时丢首尾 1s）
- **未**自动跑 CI；仅 `npm run perf:bench` 手动触发

### D — Chaos 3 隐患 Fix

#### Item 1 — `health.js` defensive redis.ping
**Commit**：`afb9b85`

`backend/src/routes/health.js`：在 `/api/health/ready` 加 `typeof redis.ping !== 'function'` guard，malformed stub 返 `{ok:false, error:'redis client missing ping()'}` 而非 throw `"redis.ping is not a function"`。

**新测 #8**：`redis stub without .ping → /ready 503, redis=down, no TypeError leak`

#### Item 2 — `userAuth` isRevoked fail-open logger
**Commit**：`5a817c5`

`backend/src/middleware/auth.js`：在 `safeCheckJti` catch 加 `logger.warn({jti, err: e.message}, 'token revocation check failed; failing open')`。fail-open 行为保留（仅 observability）。

**新测 #9**：`userAuth logs warn on isRevoked throw, still fail-open`

#### Item 3 — login 500 分类
**Commit**：`4e86747`

`backend/src/routes/auth.js`：wrapping wechat 与 DB 异常：
- `code2session` 非 AppError throw → `AppError(1501, 'wechat upstream unavailable', 502)`
- SELECT/INSERT/UPDATE throw → `AppError(1502, 'database unavailable', 503)`

通用 500 留给真意外。

**新测 #10 / #11**：
- `wechat down on login → 502 with code 1501`（ECONNREFUSED 模拟）
- `db down on login → 503 with code 1502`（pool query 模拟）

### G — mp lint + 死码扫

**Commit**：`2cc43d0`

5 文件修复：

| 文件 | 问题 | 修法 |
|------|------|------|
| `admin/pages/jobs/list.js:32` | `online` 声明未用 | 真用：toggle 按钮加 `data: { online: !online }` 传给 PATCH endpoint |
| `app.js:65` | `onCheckForUpdate(res)` | `(_res)` 回调签名保留 |
| `pages/legal/privacy.js:1` | `const app = getApp()` 未用 | 删 |
| `pages/legal/terms.js:1` | 同上 | 删 |
| `pages/me/me.js:1` | 同上 | 删 |

**死码扫**（0 候选）：
- `utils/*` 全在用（tests/adminFormat/adminValidate/auth/constants/loading/monitor/request 验证）
- `pages/**` 8 主包 + 7 admin 全 `app.json` 注册
- `components/privacy-popup/` `app.js` 动态 selectComponent 引用
- 0 TODO/FIXME 占位

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 290 | 287 | 2 | 1 |
| 2 | 290 | 287 | 2 | 1 |
| 3 | 290 | 287 | 2 | 1 |

baseline 286 → 290（+4：D chaos 4）。0 新 fail。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | C 绕过 3 层限流 | bench 单 IP，限流 ≠ 路由性能 |
| 2 | C mock LLM | 测 DB/校验不测 DeepSeek |
| 3 | C 不进 CI | 启动慢 + 单机基线；CI 跑意义小 |
| 4 | D Item 1 不 throw 改 503 | malformed 是 ops error，不是 500 |
| 5 | D Item 2 仅加 warn 不 fail-close | 用户体验优先；observability gap |
| 6 | D Item 3 区分 wechat(502)/db(503) | ops 排障快 |
| 7 | G 真用 `online` 不删 | 写 toggle endpoint 用更对（避免死 toggle button） |
| 8 | G 死码扫 0 删除 | 动态引用/TODO 风险；只列不删 |

## 风险

| 风险 | 缓解 |
|------|------|
| C bench 阈值 2000ms 误报 | env 可调；CI 不跑 |
| C 单 instance ≠ prod | docs 注明；PM2 N worker 实测 |
| D Item 1 改 503 不 500 | 503 更准确；malformed 是 ops 信号 |
| D Item 2 warn 刷屏 | 单次失败 1 warn；Redis 持续挂会触发 alert（C Round 31） |
| D Item 3 wechat 502 客户端需支持 | AppError code 文档化；前端按 status 区分 |
| G `online` 字段接到旧 API | toggle 走 `/api/admin/jobs/:id/online` PATCH 后端已支持 |

## 已知 Follow-up

| # | 项 | 优先级 |
|---|----|--------|
| 1 | 多 pod alert dedupe 改 Redis pub/sub | 低 |
| 2 | 备份码（2FA） | 低 |
| 3 | Round 32 chaos 隐患 #3（openapi duplicate） | 已修 R33 |
| 4 | prod Redis 切 GETDEL（dev 不支持） | 低 |
| 5 | perf bench 加 match/generate 真实 LLM 对比 | 中 |

## Commits

| SHA | msg |
|-----|-----|
| `0ae650e` | perf(bench): autocannon p95/p99 baseline (4 endpoints, 10s each) |
| `4e86747` | fix(auth): distinguish wechat/db failures from login 500 (codes 1501/1502) |
| `5a817c5` | fix(auth): warn log when isRevoked check fails (observability) |
| `afb9b85` | fix(health): defensive typeof check for redis.ping in /ready |
| `2cc43d0` | chore(mp): 修 5 unused-var warnings + 扫死码 |