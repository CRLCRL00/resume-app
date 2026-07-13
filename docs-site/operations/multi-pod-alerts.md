# 多 Pod 告警去重 (Round 40)

> TL;DR：多 pod 部署下，告警派发走 Redis leader election — 1 个 pod 当 leader 发 Slack，其他 pod 仅观察。30s TTL + 5s 心跳。fail-open（Redis 挂时全部发，避免漏告警）。

## 问题

每 pod 都跑 alert 评估器（`routes/metricsAlerts.js`）。当 Prometheus 外部调度器或 cron 触发同一 fired event 时，**每个 pod 都会尝试发 Slack** — 产生 N 条重复告警。

R32-F 的 dedupe 机制（`alertRouter.js` 的 `SET alert:notify:<name> NX EX <ttl>`）只在 *同一* 告警名在 TTL 窗口内被多次尝试时去重，**不能防止多 pod 在同一 fired event 上竞速**。

## 方案：Redis leader election

每个 pod 启动时尝试抢 `leader:alert` 租约：

- 抢到 → 当 leader，**所有 alert 派发走这个 pod**
- 没抢到 → 当 follower，**只观察、不发**
- Leader 崩 / 失联 → 30s 内 TTL 过期 → 下一个 pod 自动接管

### 核心 API (`backend/src/services/leaderElect.js`)

```js
const leaderElect = require('./services/leaderElect');

// 抢租约（30s TTL）
const { acquired, leader, ttl } = await leaderElect.tryAcquire('alert');

// 启动 5s 心跳（自动续约）
if (acquired) leaderElect.startHeartbeat('alert');

// 优雅关闭
await leaderElect.stopHeartbeat('alert');

// 快速判断当前 pod 是否 leader
const isL = await leaderElect.isLeader('alert');
```

### Redis 命令

```
# 抢租约 — SET NX EX 原子写
SET leader:alert "<pod-name>" EX 30 NX
  → OK          (acquired)
  → nil         (someone else owns it)

# 续约（心跳）— Lua 原子 GET + EXPIRE
EVAL "
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('EXPIRE', KEYS[1], ARGV[2])
  else return 0 end
" 1 leader:alert "<pod-name>" 30

# 释放（优雅关闭）— Lua 原子 GET + DEL（仅 leader 能 release 自己的）
EVAL "
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  else return 0 end
" 1 leader:alert "<pod-name>"
```

## 配置

| Env | 默认 | 说明 |
|-----|------|------|
| `ALERT_LEADER_TTL_SEC` | 30 | leader 租约 TTL（秒）。崩溃后最长等这么久才切换 |
| `ALERT_LEADER_HEARTBEAT_MS` | 5000 | 心跳间隔（毫秒）。必须 < TTL |

TTL 30s + 心跳 5s 的平衡：6 次心跳续约才续满一次 TTL。崩溃场景 0~30s 内切换。

## 失效场景

| 场景 | 行为 |
|------|------|
| Leader pod OOM kill | 30s TTL 过期 → 其他 pod `tryAcquire` 成功 → 自动接管 |
| Leader 网络分区 | 同上。30s 后切换。心跳时 `EXPIRE` 返回 0 → 自动 stop |
| Leader 优雅关闭 | `stopHeartbeat` 释放租约 → 下一个 pod 立即接管（无需等 TTL） |
| Leader pod 进程 hang 但 TCP 还在 | 心跳不发，30s 后切换（这是 hang 检测的最大延迟） |
| **Redis 挂** | `tryAcquire` / `isLeader` 抛错 → `alertRouter.canDispatch()` **fail-open**：所有 pod 退回"各自发"。重复风险 vs 漏告警，我们选**不漏**。ops 应同时收到告警 + Redis down alert |
| 网络抖动（Redis 偶发超时） | 单次心跳失败 → 下个 5s 继续；TTL 还有 ~25s 缓冲 |

## 监控

### `alert_leader_status`（Gauge）

```bash
# pod A（leader）
$ curl localhost:3003/metrics | grep alert_leader_status
alert_leader_status{pod="backend-7d4f8b-x7kq2",role="alert"} 1

# pod B（follower）
$ curl localhost:3003/metrics | grep alert_leader_status
alert_leader_status{pod="backend-7d4f8b-9p3mn",role="alert"} 0
```

**告警规则建议**（Prometheus）：
- 任何 pod 都没 `alert_leader_status{role="alert"} == 1` → 严重（无 leader，告警链断了）
- 多个 pod 同时 == 1 → 警告（split-brain，但本实现用 NX EX 原子写不会发生）

### `alert_dispatch_total`（Counter）

按 `{role, result}` 切片，`result ∈ sent / skipped_not_leader / failed`：

```bash
$ curl localhost:3003/metrics | grep alert_dispatch_total
alert_dispatch_total{role="alert",result="sent"} 142
alert_dispatch_total{role="alert",result="skipped_not_leader"} 87
alert_dispatch_total{role="alert",result="failed"} 2
```

**健康判据**：
- `skipped_not_leader` 应大致等于"非 leader pod 数 × sent"（每个 sent event 在 follower 上跳过）
- `failed` 应接近 0。飙升说明 Slack webhook 挂或超时
- 0 sent + 大量 `skipped_not_leader` → 所有 pod 都在争抢但都没拿到（Redis 持久故障或代码 bug）

## 与现有机制的关系

- **dedupe（`alert:notify:<name>`）**：保留。即使单 pod 部署，重复触发同一 alert 名也不重发
- **muted（`ALERT_MUTED` CSV）**：保留。leader 在发送前检查
- **forceNotify（`/metrics/alerts/test-notify`）**：也走 leader 检查。非 leader pod 上调 `/test-notify` 会返 `{ ok: false, reason: 'not_leader' }`

## 单 Pod 部署

不破现有行为：
- 单 pod 启动 → `tryAcquire` 成功 → 当 leader → 正常发
- 测试环境（`NODE_ENV=test`）→ `alertRouter.canDispatch()` 短路返 true → 直接发，不走 Redis

## Follow-up

| # | 项 | 优先级 |
|---|----|--------|
| 1 | 多 leader 角色（alert 1 个 + 慢查询聚合 1 个 + admin log cleanup 1 个） | 中 |
| 2 | Prometheus scrape `alert_leader_status==0` 告警 + split-brain 检测 | 中 |
| 3 | leader 切换事件写 securityLog（便于审计"谁当过 leader"） | 低 |
| 4 | 用 Redlock 库替代手写 SET NX EX（多 Redis 实例场景） | 低 |
| 5 | 心跳间隔自适应（网络抖动大时拉长） | 低 |

## 相关文件

- `backend/src/services/leaderElect.js` — Redis leader election（核心）
- `backend/src/services/alertRouter.js` — 包装 `canDispatch()` gate
- `backend/src/routes/metrics.js` — 注册 `alert_dispatch_total` + `alert_leader_status`
- `backend/src/index.js` — 启动时抢租约 + 10s 周期刷新 gauge + 优雅关闭释放
- `backend/tests/leaderElect.test.js` — 7 测（acquire/release/TTL/handoff/non-leader release/hearbeat 续约）
- `backend/tests/alert-dedupe.test.js` — 4 测（leader=true/false/switch/fail-recovery）
- `docs-site/operations/alerts.md` — 总体告警文档（提及本机制作为多 pod 行为）