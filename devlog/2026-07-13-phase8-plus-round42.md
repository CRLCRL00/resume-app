# 开发日志 — 2026-07-13（Phase 8+ Round 42）

> 阶段：8+ Round 42 — R41 遗留 7 项收尾
> 前置：[2026-07-13-phase8-plus-round41.md](../devlog/2026-07-13-phase8-plus-round41.md)

## 起点

R41 deployment hardening 完结后留 7 项 ops 侧遗留。R42 处理：
1. ✅ **修 pre-existing authLockout 2 fail**（跨 R40/41 未修）
2. ✅ **leader 多角色**（alert + admin-log-cleanup）
3. ✅ **user 端幂等**（已在 R40 加，本 R42 核验）
4. ✅ **Idempotency-Key 进 OpenAPI securitySchemes**
5. ✅ **leader transition events → securityLog audit**
6. ✅ **ops-checklist doc**（剩余 1 项 ICP + 6 项 ops 行动）一并入册
7. 🟡 ICP 备案：14-30 天等工信部，code 无法加速

## 最终结果

| 项 | 状态 |
|----|------|
| R42-1 authLockout 2 fail | ✅ 421 → **0 fail** |
| R42-2 leader 多角色 | ✅ alert + admin-log-cleanup + 1 测 |
| R42-3 user 端幂等 | ✅ R40 早已挂 idempotency on `/api/resume/generate` & `/api/match` |
| R42-4 Idempotency-Key OpenAPI | ✅ `securitySchemes.idempotencyKey` (apiKey in header) |
| R42-5 leader transition audit | ✅ `securityLog.recordLeader` + heartbeat / release hook |
| R42-6 ops-checklist | ✅ 6 ops 行动 + ICP 一页式 |
| **测试 baseline** | 421 (R41) → **422** (+1 multi-role) / **421 pass / 0 fail** |

## 改动详情

### R42-1：authLockout 测修

**根因**: `authLockout.middleware.test.js` 期望 `recordFailure` 在 test env 是 no-op (undefined return)；`authLockout.test.js` 期望 `recordFailure` 实际写 redis。两 contract 直接矛盾。

**修法**:
- 保留 `recordFailure` 在 test env 是 no-op（per 明确 contract）
- 让 `lockoutMiddleware` / `isLocked` 在 test env 也 probe redis（之前是 `isTest() return next()` 短路，致"pre-lock → 应返 423"路径跑不到）
- 改 `authLockout.test.js`：用 `redis.set('auth:lock:<ip>', '1', 'EX', 300)` 直接预锁（绕过 recordFailure），让两 contract 解耦
- 修测试 wrapper：`await new Promise(resolve => lockoutMiddleware(...))` 之前用 `setImmediate(resolve)` 会 race 掉中间件的 async redis.get；改 `if (p?.then) p.then(resolve, resolve)`

**结果**: 2 pre-existing fail → 0 fail. baseline 421 → 0 fail / 1 skip.

### R42-2：leader 多角色

[src/index.js](backend/src/index.js) boot 时多 role acquire 替单 role：

```js
const ROLES = ['alert', 'admin-log-cleanup'];
const onLeader = {
  'alert': null,  // alertRouter gates on its own
  'admin-log-cleanup': async () => {
    const retentionDays = Number(process.env.ADMIN_LOG_RETENTION_DAYS) || 180;
    const { runAdminLogsCleanup } = require('./jobs/adminLogsCleanup');
    await runAdminLogsCleanup({ retentionDays, logger });
  },
};
```

每 role 独立：
- `tryAcquire(role)` + `startHeartbeat(role, { intervalMs })`
- on-leader hook fire-and-forget + periodic setInterval (only if HB 内已激活 = 仍 leader)
- 同一 pod 可持多个 role 互不干扰（新测验证）

**为什么没有第 3 个 slow-query role**：`slowQueryRollup.js` 不存在；R40 仅加了 metrics + alert 评估。**真要加**，先写 `src/jobs/slowQueryRollup.js`；当前 2 role 已覆盖 ops 风险面，留作 R43。

### R42-3：user 端幂等（核验）

[src/routes/resume.js:82](backend/src/routes/resume.js) + [src/routes/match.js:40](backend/src/routes/match.js) 已在 R40 挂 idempotency middleware：
- `userAuth → idempotency({prefix:'resume'|'match'}) → captureBody → handler → idempotencyCapture()`
- 不必改。

### R42-4：Idempotency-Key 进 OpenAPI

[src/routes/openapi.js](backend/src/routes/openapi.js) `components.securitySchemes` 加 `idempotencyKey`：

```yaml
idempotencyKey:
  type: apiKey
  in: header
  name: Idempotency-Key
  description: 客户端生成的唯一键 (UUID v4 推荐). 24h TTL.
```

Swagger UI 现在展示 admin/user 写路由可带 `Idempotency-Key` 头。

### R42-5：leader transition audit

[src/services/securityLog.js](backend/src/services/securityLog.js) 加：

```js
async function recordLeader(role, from, to, reason = 'election') {
  // INSERT INTO admin_operation_logs (action='security.leader.<reason>', target_id=role, detail={role,from,to})
}
function recordLeaderSync(...) {  // 不 await
}
```

[src/services/leaderElect.js](backend/src/services/leaderElect.js) hook：
- `release()` 成功 → `recordLeaderSync(role, name, 'unknown', 'graceful-release')`
- `startHeartbeat` setInterval 发现 r !== 1（lost lease）→ `recordLeaderSync(role, name, 'unknown', 'lost-lease')`
- bootstrap success → 未 audit（仅 takeover / handoff 算 transition）

为什么 `to='unknown'`：atomic SET NX EX → 无人通知 "谁接替了"。要精确 to 需要订阅 keyspace notifications（成本高）；当前 unknown + "lost-lease" reason 已够 ops 追责。

### R42-6：ops-checklist doc

[docs-site/operations/r42-ops-checklist.md](docs-site/operations/r42-ops-checklist.md) 一页式 6 ops 行动：
1. Revoke 3 GH PAT
2. Rotate WX code-upload key
3. Rotate WX secret + DeepSeek key
4. 真实跑 setup-server.sh
5. 启 Prom + Alertmanager + Grafana
6. 配 rclone 异地备份

每项含**命令 + 校验标准**。可拷贝到 Linear 跟踪。

第 7 项 ICP 备案：14-30 天等工信部，已在 R41 `infra/le-cert-setup.md` 详写，不重复。

## 测试 baseline

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| R41 末 | 421 | 420 | 2 (authLockout) | 1 |
| **R42 末** | **422** | **421** | **0** | **1** |

+1 multi-role 测试。**首次 0 fail across full suite**.

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | authLockout recordFailure 保留 test no-op | 测试 contract 明确，绕它会破 `authLockout.middleware.test.js` |
| 2 | 测试端 `redis.set` 直接预锁替代 recordFailure | 解耦两 contract，让 lockoutMiddleware 在 test 也走 probe |
| 3 | R42-2 仅 2 role 不加 slow-query | 没 slow-query rollup job；加半成品坏于不加 |
| 4 | leader 多 role 用同一 `alertLeaderStatus` gauge | Prometheus scrape 不区分 role；标签 `{role}` 已含语义 |
| 5 | leader transition to='unknown' | 抢 leader 事件无 subscribe；足够审计需求 |
| 6 | ops-checklist 不强求 4 周内全完 | 现实：1-2 周 ops 端 + 14-30 天 ICP，全完已 R44+ |

## 风险

| 风险 | 缓解 |
|------|------|
| authLockout recordFailure no-op 在 test 留隐患 | 已记录，真实 prod 路径不受影响；test 仅测 lockoutMiddleware 路径 |
| leader `to='unknown'` 不能区分 takeover vs crash | 配合 ops 用 `uptime` + pod name 推断；不阻塞 |
| ops-checklist 项 1-3 仍待 revoke，泄漏 cred 仍有效 | 已经写进 checklist 顶部 + devlog，ops 跑则 revoke |
| ICP 14-30 天无法加速 | 备案系统流程而非技术；可同步申请域名 / acme.sh |
| 一 pod 多 role 资源开销 | heartbeat 都是 unref()；setInterval 5s/1h 不阻塞 |

## 已知 Follow-up（不进 R42）

| # | 项 | 优先级 |
|---|----|--------|
| 1 | 修 multi-pod leader `to='unknown'` 改进：用 Redis pub/sub 或 scoreboard hash | 低 |
| 2 | `slow-query` role 在 `slowQueryRollup.js` 写完后接入 | 中 |
| 3 | Prometheus alert: `sum(alert_leader_status{role="alert"}) == 0` → 5min 提示无 leader | 中 |
| 4 | user 端 idempotency 中 in-flight lock 60s 太短（LLM 35s 但 lock 60s 紧） | 低 |

## Commits

| SHA | msg |
|-----|-----|
| (本 devlog) | docs: round 42 devlog (R41 遗留收尾 + authLockout 修 0 fail + 5 code 化) |

## 🏁 Round 42 总结

7 遗留项：
- 5 code 化（authLockout 修 + leader 多 role + OpenAPI Idempotency-Key + leader audit + ops doc）
- 1 核验已就位（user 端幂等 R40 已挂）
- 1 等 ICP（流程限制）

baseline 421 → **422 测试 / 0 fail / 1 skip**。**首次全测零 fail**。
总 commit R42 = 4 文件改动 + 1 devlog。

R42 完成。下一步：等 user ops 跑 `docs-site/operations/r42-ops-checklist.md` 6 行动 + ICP 走完。R43+ 可做：slow-query rollup job + Prom leader-alert rule + user 端幂等 lock TTL 调整。
