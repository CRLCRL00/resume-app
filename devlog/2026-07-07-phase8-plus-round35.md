# 开发日志 — 2026-07-07（Phase 8+ Round 35）

> 阶段：8+ Round 35 — ADF hardening
> 前置：[2026-07-07-phase8-plus-round34.md](../devlog/2026-07-07-phase8-plus-round34.md)

## 目标

3 hardening 项：
B. 真实 LLM perf 对比（mock vs DeepSeek）
D. 2FA 备份码（recovery flow）
E. 慢查询 dashboard（DB 可观测）

## 最终结果

| 项 | 状态 |
|----|------|
| B perf bench real-LLM | ✅ 4 endpoints + llm histogram + token capture |
| D 2FA 备份码 | ✅ 8 codes + SHA-256 存 + 单次消费 + 8 测 |
| E 慢查询 dashboard | ✅ ring buffer + Prometheus + 2 端点 + 17 测 |
| **npm test 3x** | ✅ **316 / 313 pass / 2 fail / 1 skip** × 3 |

baseline 290 → 316（+26：B 1 + D 8 + E 17）。2 fail pre-existing authLockout。

## 改动详情

### B — Real-LLM Perf Bench

`backend/scripts/perf-bench.js`（重构 + 扩展）：
- 提取 `runBench({realLlm, duration, llmConcurrency})` + `printComparisonTable()` — 可测可复用
- CLI flag `--real-llm` 或 env `BENCH_REAL_LLM=1`
- Real 模式：清掉 llm-chain mock stub，让真实 DeepSeek 流过；低并发 2、长 duration 30s（避 60 RPM 限流）
- 关键决策：**wrap `axios.post` 而非 `llm.chat`** — 路由 handler 缓存 `require('axios')` 引用，躲过 require.cache eviction；axios 是 singleton，所有 DeepSeek 调用都覆盖

`backend/src/services/llm.js` + `routes/metrics.js`：
- 新 `llmRequestDuration{operation, model}` Histogram
- `llm.chat` try/finally 记录耗时

`docs/perf-bench.md`（扩）：real 模式用法 / 成本警告（~$0.01-$0.05/run）/ RPM 限流 caveat。

**Mock 样本**（1s duration）：
```
Endpoint                  | p99 (ms) | Tokens/call
GET  /api/health          |       53 | (no LLM)
POST /api/resume/save     |      987 | (no LLM)
POST /api/resume/generate |      983 | (no LLM)
POST /api/match           |       14 | (no LLM)
```

**Real 模式代码路径**：mock fetch 拦截 DeepSeek 响应 → `tokens_per_call` 正确捕获（gen 2 call × 1070 tok；match 580 call × 1070 tok）。真实 run 跳过（无 API key）。

### D — 2FA 备份码

`backend/src/services/twoFactor.js`（扩）：
- `generateBackupCodes({ count=8 })` → `{ plaintext: ['a1b2-c3d4', ...], hashes: [sha256hex, ...] }`
- `consumeBackupCode({ openid, code })` → normalize (lowercase + 删 dash) + hash 比对 + 原子删
- `listBackupCodeCount({ openid })` → remaining count
- `normalizeBackupCode / hashBackupCode` 内部分离函数（可测）
- 8 hex chars (32 bits entropy) 格式 `xxxx-xxxx`，单次使用

`backend/src/routes/admin/twoFactor.js`（改）：
- POST `/enable` 启用后生成 8 码，存 SHA-256 hash 列；返 `{ enabled, backupCodes: [...] }` 明文仅一次
- POST `/verify` **改**：先试 TOTP（6 位），非数字 fallback backup code；两条路径返相同 `{ challengeToken }` shape
- GET `/status` 增 `backupCodesRemaining`
- DELETE `/` 故意保留 TOTP-only — backup code 不能当 disable 路径（防钓鱼攻击者锁定 admin）

8 测全过：
1. enable 返 8 plaintext codes（unique + format）
2. codes 存的是 SHA-256（DB row 无明文）
3. backup code → challengeToken
4. 用后 remaining = 7
5. 大小写/横线 normalization
6. 复用 → 400
7. 错码 → 400
8. 用完 8 → remaining = 0

### E — 慢查询 Dashboard

`backend/src/services/queryMetrics.js`（新，165 行）：
- Ring buffer max 500，FIFO 淘汰
- `recordQuery / getRecentSlowQueries / getStats`
- `extractOperation` (SELECT/INSERT/UPDATE/DELETE/REPLACE/CALL)
- `extractTable` (FROM/INTO/UPDATE 后第一个 identifier，fallback "unknown")
- 跳过 `SET / SHOW / USE / START TRANSACTION / COMMIT`（admin/protocol 查询不入 buffer）
- SQL 截断 200 字（防大 INSERT 撑爆内存）
- `_resetForTests` + `_bufferForTests` 测试钩子

`backend/src/routes/metrics.js`：
- 新 `db_query_duration_seconds_v2` Histogram `{operation, table}` buckets `[0.001, 0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5]`
- 新 `db_slow_queries_total` Counter `{operation, table}`
- ⚠️ **deviation**：spec 命名 `db_query_duration_seconds`（与旧 histogram 同名）。prom-client 不允许同 name 不同 labels，故用 `_v2` 后缀。语义对齐 spec。

`backend/src/config/db.js`（改）：wrap 函数追加 `queryMetrics.recordQuery(...)` 调用。

`backend/src/routes/admin/queries.js`（新，60 行）：
- `GET /api/admin/queries/slow?limit=20&since=1h` → ring buffer 过滤（sinceMs）
- `GET /api/admin/queries/stats` → `{ slowQueryThresholdMs, totalTracked, slowCount, byTable }`
- `userAuth + adminAuth` 数组

17 测：
- 13 unit（recordQuery / extractOperation / extractTable / ring eviction / sinceMs / byTable / 截断 / 跳过 admin）
- 4 integration（auth 401/403/200 + 返回）

## 🔧 Bug Fix — queryMetrics Test-env 短路

子 agent 写 `recordQuery` 加了 test env 短路 `if (process.env.NODE_ENV === 'test') return;` —— 但自己写的 unit test 又依赖 `recordQuery` 真的写状态。冲突 → 7 unit test + 2 integration test 失败。

**修**：
- `queryMetrics.js`：移除 `recordQuery` 内部短路，函数永远工作
- `db.js` wrap：**在调用 `recordQuery` 前**检查 `NODE_ENV !== 'test'`

这样：
- 单测可调 `recordQuery` 验真实逻辑（用 `_resetForTests` 隔离）
- 生产路径（db.js wrap）在 test env 短路，不污染 buffer
- ring buffer 在测试间干净

Commit：`f981adc`

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 316 | 313 | 2 | 1 |
| 2 | 316 | 313 | 2 | 1 |
| 3 | 316 | 313 | 2 | 1 |

baseline 290 → 316（+26：B 1 + D 8 + E 17）。0 新 fail。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | B wrap axios.post 而非 llm.chat | 路由缓存 require('axios')，绕不开 |
| 2 | B real 模式并发 2 / 30s | DeepSeek 默认 60 RPM；sustained ≤ 1 req/s |
| 3 | B 不进 CI | 启动慢 + 成本；手动按需 |
| 4 | D SHA-256 不用 bcrypt | 32 bit 随机足够；bcrypt 慢无意义 |
| 5 | D /verify 接受两种 | 客户端不变；TOTP-first fallback backup |
| 6 | D DELETE 仅 TOTP | 防钓鱼；backup code 不能 disable 2FA |
| 7 | E 用 _v2 而非改名旧 histogram | 不破现有 dbMetrics 测试；语义对齐 |
| 8 | E 跳过 SET/SHOW/USE/START/COMMIT | admin/protocol 噪声 |
| 9 | E SQL 截断 200 字 | 大 INSERT 保护内存 |
| 10 | Bug Fix：短路在 caller 而非 recordQuery | 测试要调真实逻辑 |

## 风险

| 风险 | 缓解 |
|------|------|
| B real 模式可能撞 DeepSeek 限流 | env 控制；60 RPM 容忍；CI 不跑 |
| B token cost 累积 | 单 run ~$0.01-$0.05；监控可在 alert 里加 |
| D backup code 32 bit 熵够？ | 单次使用；暴破需同时猜 openid + code |
| D /verify fallback 增加 attack surface？ | TOTP-first；fallback 仅在 TOTP 失败后；消耗原子 |
| E ring buffer 500 上限可能丢重要慢查询 | Prometheus histogram 永久保留；buffer 仅 UI 用 |
| E _v2 命名与 spec 不同 | 已记 deviation；后续可重命名统一 |

## 已知 Follow-up

| # | 项 | 优先级 |
|---|----|--------|
| 1 | 多 pod alert dedupe 改 Redis pub/sub | 低 |
| 2 | perf bench 加 match/generate 真实 LLM 对比（已在 R35 实现路径） | 中 |
| 3 | prod Redis 切 GETDEL（dev 不支持） | 低 |
| 4 | E 把 _v2 改回 spec 命名（重命名 + 旧 histogram 迁移） | 低 |
| 5 | 慢查询告警（>5 次/分钟某表）接入 metricsAlerts | 中 |

## Commits

| SHA | msg |
|-----|-----|
| `f981adc` | fix(metrics): queryMetrics test-env short-circuit moved to db.js wrap |
| `073d36a` | docs(perf-bench): real-LLM mode usage, cost warning, rate limit caveat |
| `586621f` | perf(bench): real-LLM mode with DeepSeek token capture + llm duration histogram |
| `d7780c9` | feat(admin): /api/admin/queries/slow + /stats endpoints |
| `fd06fdd` | feat(metrics): db_query_duration_seconds_v2 histogram + db_slow_queries_total counter |
| `d6c0ab9` | feat(metrics): queryMetrics service ring buffer + slow detect |
| `2f2fb01` | feat(2fa): /verify 接受 backup code, /enable 返回明文一次性 |
| `3884d03` | feat(2fa): backup code generation + hashing |