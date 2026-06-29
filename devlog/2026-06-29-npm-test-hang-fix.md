# 开发日志 — 2026-06-29（npm test Hang 修复）

> 阶段：6+（Phase 6 后 hardening）
> 前置：[2026-06-29-phase6-verify.md](2026-06-29-phase6-verify.md)
> Spec：[2026-06-29-...-npm-test-hang-design.md](../docs/superpowers/specs/2026-06-29-简历推荐小程序-npm-test-hang-design.md)
> Plan：[2026-06-29-...-npm-test-hang.md](../docs/superpowers/plans/2026-06-29-简历推荐小程序-npm-test-hang.md)

## 目标

`cd backend && npm test` 60s+ hang → < 30s 正常退出。

## 最终结果

| 项 | Before | After |
|----|--------|-------|
| `npm test` 时间 | 60s+ hang | **~11s** |
| 通过 | n/a（hang）| **106/111** |
| 失败 | n/a | **5（pre-existing LLM）** |
| 退出码 | 1 (timeout) | 1（5 LLM fail）|

## 决策方案：A+E+D 混合（用户选）

A = Per-file pool（**createPool() 工厂** + **helper**）
E = rateLimit **beforeEach** 清 key（matchService 文件）
D = **`--test-force-exit`**（Node 22+ 兜底）

后续 follow-up：加 **`--test-concurrency=1`**（控文件并发，防跨文件 state pollution）

## 根因（确认）

1. **跨文件池冲突**：`node --test tests/*.test.js` 并发跑文件，每个文件 `test.after` 调 `pool.end()` 在 singleton 上 → 第一个文件退出永久关共享池 → 其他文件卡死
2. **rateLimit INCR 漏**：`service-matchService.test.js` 5 测试共用 `match:998` key，INCR 不清 → 第 5 次触发 429
3. **Node `--test` 并发**：加剧 #1

## 已落地

### 文件改动

| 文件 | 改动 |
|------|------|
| `src/config/db.js` | 加 `createPool()` 工厂 |
| `src/config/redis.js` | 加 `createRedis()` 工厂 |
| `tests/helpers/db.js` | 新建（懒初始化 pool/redis + cleanup） |
| `package.json` | `--test-force-exit --test-concurrency=1` |
| `backend/README.md` | 加 `## 测试要求` 段 |
| 6 个已有 test.after 文件 | 改 helper |
| 13 个新文件 | 加 helper |
| `service-matchService.test.js` | 加 `test.beforeEach` 清 rateLimit key |

总计 **22 测试文件迁移**（route-* + middleware-admin-auth + admin-* + service-* + db/redis 连接测试）。

### Commits（12 个）

```
97c42c8 chore(backend): add --test-concurrency=1 (避免跨文件 state pollution)
b1e34c4 test(db+redis): migrate to tests/helpers/db.js
f3a8e01 test(admin+service): migrate to tests/helpers/db.js
dbafbdf test(middleware): migrate to tests/helpers/db.js
050abb5 test(route-*): migrate 6 files to tests/helpers/db.js
279cd6a test(matchService): use helper + beforeEach clears rateLimit
308aebf docs(backend): clarify engine bump to Node 22+ in README intro
10f6cc1 chore(backend): bump engine to ≥22 + add --test-force-exit + docs
6b04f4d test(backend): add tests/helpers/db.js for per-test isolation
c09d936 refactor(backend): add createRedis() factory for per-test isolation
ccec367 refactor(backend): add createPool() factory for per-test isolation
c2c7d02 docs(plan): npm test hang fix execution plan (A+E+D)
74ae4a7 docs(spec): npm test hang fix design (A+E+D hybrid)
```

## 验收（3x 一致性测试）

| Run | 通过 | 失败 | duration |
|-----|------|------|----------|
| 1   | 106/111 | 5 | 10.9s |
| 2   | 106/111 | 5 | 10.3s |
| 3   | 106/111 | 5 | 10.1s |

**稳定的 5 个失败**：

```
1. POST /api/resume/generate with non-existent resume returns 404
2. POST /api/resume/generate hits DB cache when content_md exists
3. POST /api/resume/generate calls LLM when no cache and stores result
4. POST /api/resume/generate returns 502 on LLM failure
5. match returns empty when no candidates
```

全部为 **DeepSeek API key `sk-...42df is invalid`**（pre-existing，env 中 key 已过期或残缺）。非本次范围。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A+E+D 混合（用户选） | 根治 + 兜底 |
| 2 | Helper 模式统一生命周期 | 减少每个测试文件的样板 |
| 3 | singleton 不被任何测试 end | 跨文件并发安全 + route 共享池 |
| 4 | `const { getPool, ... }` + `const pool = getPool()` | 保持 `pool.query(...)` 不破；原 spec `{ getPool: pool }` 是 spec bug |
| 5 | `--test-concurrency=1`（follow-up 增补） | 11 个跨文件 fail 中 7 个从并发暴露，单测通过 → 加并发控制更稳 |
| 6 | pre-existing DeepSeek key fail 留作 follow-up | 不在本次范围 |

## 已知遗留

- 5 个 DeepSeek 测试 fail（API key 问题，需换有效 key 或 mock LLM）
- `service-rateLimit.test.js` 部分迁移（singleton 注入设计限制，需要重构 rateLimit.js 支持依赖注入才能完整切换）
- `route-resume-generate-llm.test.js` 在并发模式下 hit `generate:1` rateLimit 跨文件污染（`--test-concurrency=1` 已缓解）

## Phase 7 启动清单（更新）

- [x] npm test hang 修
- [ ] DeepSeek API key 修复或测试 mock LLM
- [ ] service-rateLimit 依赖注入重构（可选）
- [ ] Phase 7 设计（审核准备）
- [ ] 真机生产验
