# 开发日志 — 2026-07-08（Phase 8+ Round 40 Batch 3）

> 阶段：8+ Round 40 Batch 3 — ADF hardening（final batch）
> 前置：[2026-07-08-phase8-plus-round40-batch2.md](../devlog/2026-07-08-phase8-plus-round40-batch2.md)

## 目标

最后 2 项 hardening：
H. Admin 幂等键（idempotency-key 防重试重复）
A. 多 pod dedupe（leader election via Redis）

## 最终结果

| 项 | 状态 |
|----|------|
| H admin 幂等键 | ✅ 16 写路由 + 9 测（f263461）|
| A 多 pod dedupe | ✅ leader election + 4 改 5 加 + 11 测（e202d43）|
| **npm test 3x** | ✅ **420 / 417 pass / 2 fail / 1 skip** × 3 |

baseline 402 → 420（+18：H 9 + A 11 - 2 merge）。2 fail pre-existing authLockout。

## 改动详情

### H — Admin 幂等键

`backend/src/middleware/idempotency.js`（重写）：
- 读 `Idempotency-Key` 头
- **key reuse 不同 body** → 409 Conflict
- **in-flight 锁**：`SET NX EX 60s` 防止并发同 key 重复处理
- **24h result cache**：2xx 响应缓存
- **Redis 挂** → fail-open（log warn + 透传）
- **KEY_REGEX** 校验：1-128 alphanumeric + `-_`
- **hashBody**：sha256(req.body) 用于判 body 异同

16 个 admin 写路由挂 idempotency：

| File | Routes |
|------|--------|
| jobs.js | POST /jobs, PUT /jobs/:id, PATCH /jobs/:id/online, DELETE /jobs/:id, PATCH /jobs/:id/restore |
| prompts.js | PUT /prompts/:code |
| admins.js | POST /users, DELETE /users/:openid |
| twoFactor.js | POST /setup, POST /enable, POST /verify, DELETE / |
| legal.js | POST /legal-version |
| logs.js | DELETE /logs/prune, POST /logs/retention-trigger, POST /logs/archive |

9 测：hashBody x3 + KEY_REGEX x6 + middleware noop x1

`docs-site/operations/idempotency.md`（新）：用法、语义、TTL、降级、follow-up

### A — 多 pod Dedupe

`backend/src/services/leaderElect.js`（新，245 行）：
- `tryAcquire(role, ttlSec=30)`：`SET leader:{role} <pod> EX 30 NX` 原子
- `release(role)`：仅当前 leader 可 release
- `isLeader(role)`：本 pod 是否是 leader
- 5s 心跳：setInterval 续约（Lua 检查自己仍是 leader 再 EXPIRE）
- pod name 来源：`os.hostname()` + `process.pid`

`backend/src/services/alertRouter.js`（改）：
- `canDispatch()` gate 包 `evaluateAndNotify` + `forceNotify`
- 失败模式：Redis 挂 → fail-open（all pods notify，不静默）
- `__setCanDispatchForTests` test hook

`backend/src/index.js`（改）：
- 启动时 `tryAcquire('alert')` + 10s gauge refresh
- graceful shutdown `stopHeartbeat` 释放

`backend/src/routes/metrics.js`（改）：
- `alert_dispatch_total{role,result}` counter（sent / skipped_not_leader / failed）
- `alert_leader_status{pod,role}` gauge（0/1）

11 测：leaderElect 7（acquire / held / release / TTL expiry / multi-pod 模拟 / heartbeat）+ alert-dedupe 4（leader gate / 切换 / fail-open）

`docs-site/operations/multi-pod-alerts.md`（新，158 行）：
- 多 pod 重复问题
- Leader election via Redis SET NX EX
- 30s TTL + 5s 心跳配置
- 失效场景：leader crash → 30s 内新 pod 接管
- 监控：`alert_leader_status` gauge

**架构对比**：

| Aspect | Before (R32-F/R36) | After (R40) |
|--------|-------------------|-------------|
| 多 pod dispatch | 每 pod 都发（60min dedupe 兜底，跨 pod race）| 1 pod 赢 leader lease，follower 跳过 |
| Acquire | n/a | `SET leader:alert <pod> EX 30 NX` 原子 |
| Redis 挂 | fail-open（datasafe 错通知）| fail-open（不静默）— 同 posture |
| Leader crash | n/a | TTL 30s → 自动接管 |
| force-notify | 总是发 | 非 leader 返 `{ok:false, reason:'not_leader'}` |
| Test env | 直接发 | `canDispatch()` short-circuit true |
| Observability | dedupe skipped 字符串 | counter + gauge 量化 |

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 420 | 417 | 2 | 1 |
| 2 | 420 | 417 | 2 | 1 |
| 3 | 420 | 417 | 2 | 1 |

baseline 402 → 420（+18：H 9 + A 11 - 2 merge）。0 新 fail。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | H 409 on key reuse 不同 body | 客户端 bug 信号；不能返原 response（语义错）|
| 2 | H in-flight 锁 SET NX EX 60s | 防止并发同 key 重复处理；2 次请求都拿锁 → 第 2 次拒 |
| 3 | H 4xx 5xx 不缓存 | 客户端可能修 payload 后重试 |
| 4 | H Redis 挂 fail-open | 幂等是优化，非关键；不破可用性 |
| 5 | H 16 admin 写路由全覆盖 | admin 操作风险高；user 端可后续扩 |
| 6 | A SET NX EX 而非 Redlock | 单 Redis；Redlock 复杂度不必要 |
| 7 | A 30s TTL + 5s heartbeat | 平衡切换速度（30s 内）vs Redis 压力（每 pod 5s 1 次）|
| 8 | A fail-open on Redis 挂 | alert 静默比重复发更糟 |
| 9 | A gauge 暴露 pod name | ops 可看到当前 leader 节点 |
| 10 | A force-notify 也 gate leader | 防止多 pod 同时按 button 重复发 |

## 风险

| 风险 | 缓解 |
|------|------|
| H 24h cache 长 → 客户端永久复用 key | 文档建议 UUID v4 一次性 |
| H admin 写未带 key 仍正常工作 | passthrough；不强制但鼓励 |
| A leader 切换 30s 内可能丢 alert | trade-off：vs 多 pod 重复发；TTL 越短切换越快但 Redis 压力越大 |
| A heartbeat 续约失败（网络分区） | 5s 一次；30s TTL 容忍 ~5 次失败 |
| A force-notify 非 leader 返 not_leader | ops 需手动 retry 到 leader pod（或删 key 强制切换）|

## 已知 Follow-up

| # | 项 | 优先级 |
|---|----|--------|
| 1 | user 端写接口幂等（resume/generate, match/generate）| 中 |
| 2 | 多 leader 角色（alert 1 + slow-query 1 + admin-log cleanup 1）| 中 |
| 3 | Prometheus alert: `alert_leader_status{role="alert"} == 0` on all pods | 中 |
| 4 | Leader transition events → securityLog audit | 低 |
| 5 | Redlock lib if multi-Redis | 低 |
| 6 | OpenAPI `Idempotency-Key` 头进 securitySchemes | 低 |
| 7 | 修 pre-existing authLockout 2 fail | 低 |

## Commits

| SHA | msg |
|-----|-----|
| `f263461` | feat(admin): idempotency keys for write ops (CD) |
| `e202d43` | feat(alerts): multi-pod dedupe via Redis leader election (SET NX EX + 30s TTL + 5s heartbeat) |

## 🏁 Round 40 总结

3 batches × 3 items = 8 项完成：
- Batch 1：B admin panel + C chaos #12 + F joi requestBody
- Batch 2：D WeChat MP + E Sentry MP + G docs-site domain
- Batch 3：H admin 幂等键 + A 多 pod dedupe

总 commit 增 13 + 1 devlog = 14 commits。
总测试 350 (R37) → 420 (+70)。
2 pre-existing fail 未修（authLockout）。

R40 完成。下一步：等 user 指示继续 R41+ 或 收尾。
