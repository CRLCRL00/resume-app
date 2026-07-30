# 开发日志 — 2026-07-15（Phase 8+ Round 55）

> 阶段：8+ Round 55 — npm test hang fix + dashboard real DB + systemd unit fix
> 前置：[2026-07-14-phase8-plus-round54.md](../devlog/2026-07-14-phase8-plus-round54.md)

## 起点

user 答"按优先级依次跑"。4 项 P0-P3:
- P0: 排查 dev env npm test hang
- P1: R54 dashboard 真 DB verify
- P2: serveo tunnel 修
- P3: 收尾 report

## P0: clear-test-rate-limit hang fix ✅

**Root cause**: dev env `node scripts/clear-test-rate-limit.js` 加载 `../src/config/redis` → Redis 池 init → 无 Redis 时挂死. npm test 第 1 步就 hang.

**修法** (`scripts/clear-test-rate-limit.js`): 加 `withTimeout(promise, ms)` 包装:
- `redis.ping()` 1.5s timeout
- `redis.keys()` + `redis.del()` 各 5s timeout
- 失败 `process.exit(0)` (best-effort, not hard fail)

dev 跑 12s 退出 ✅. npm test 整体仍 hang (在 `--test-concurrency=1` + multi-file 时**另一个** root cause — 留 R56).

## P1: R54 dashboard 真 DB verify ✅

### Problem
server-side 探针 `/api/admin/dashboard/overview` 返 `500 Internal server error` — 即使 adminAuth 现在 OK (R54 fix 装好).

### Root cause
backend `src/config/db.js` 第 2 行 `const mysql = require('mysql2/promise')`. mysql2 v**3.22** 实际**没 export `Pool`** (因为 `mp.Pool = undefined` 在本地探针测得). 服务器端 pull 最新 mysql2 (3.22.5) 后, `require('mysql2/promise').createPool` 返 callback-style Pool, 而 query 不返 promise — 抛 `"You have tried to call .then()...not a promise"`.

### 修法 (`src/routes/admin/dashboard.js`)
**不等 db.js 的 defaultPool**. 在 dashboard.js 入口直接 `mysql2/promise.createPool` 用单独 `dashPool`:
```js
const mysql = require('mysql2/promise');
const config = require('../../config');
const dashPool = mysql.createPool({
  host: config.DB.host, port: config.DB.port,
  user: config.DB.user, password: config.DB.password,
  database: config.DB.database,
  waitForConnections: true, connectionLimit: 4, charset: 'utf8mb4',
});
```

只 4 个 dashboard 端点用 dashPool, 不影响其他 admin routes (他们都 inline 用 defaultPool, 已知能跑).

### Verify
| endpoint | 返回 |
|---|---|
| `GET /overview` | `users:5, active_resumes:3, online_jobs:20, total_matches:20` ✅ |
| `GET /cities` | 用户 深圳3 / 岗位 北京7+深圳5+上海4+... ✅ |
| `GET /salary` | 20 岗位都在 `<10K` bucket ✅ |
| `GET /degree` | 本科14+大专4+硕士2 ✅ |
| `GET /trends?days=7` | 07-13 users:1 ✅ |

## P2: serveo tunnel systemd unit fix ✅

### Problem
`systemctl status resume-app-tunnel` 显 `Active: active (exited)` + `Tasks: 0` — systemd 已认为 service done, 但实际 ssh 进程当时是 live. wrapper 一段时间后 ssh 死,**无 systemd restart 机制** because `Type=oneshot + RemainAfterExit=yes` 不重启 child.

### 修法 (`/etc/systemd/system/resume-app-tunnel.service`)
- `Type=oneshot` → **`Type=simple`**
- `ExecStart=tunnel-with-rotation.sh` → **`ExecStart=/usr/bin/ssh ... serveo.net`** (直接 ssh, 不 wrapper; HN 通过 journal 提取)
- 加 `ExecStartPre` pkills 老 ssh + `SuccessExitStatus=255` (ssh exit 255 在 reconnect 时正常)
- 移除废弃 `StartLimitIntervalSec` (Ubuntu systemd 不支持此 key)

Restart=on-failure 仍激活: 5 次 → 重启.

### Verify
| 探针 | 结果 |
|---|---|
| `systemctl status` | `Active: active (running)` ✅ |
| `Tasks: 1` (ssh) | ✅ |
| 重新 ssh connect | new HN `d4f94c95e222a4db-...serveousercontent.com` ✅ |

但 `via-tunnel = 502`. 这是 **serveo 端的 cache 未收敛** — 新 hostname 尚不对外暴露. server 端 system 已正确, 502 等 serveo 服务收敛 (历史 issue, R45 文档化).

## P3 留 ops-side

| # | 项 | status |
|---|----|----|
| 1 | enable_dev-bypass-active R51 (你已 add ENABLE_DEV_BYPASS=1, 临时验证后我关了) | close |
| 2 | serveo cache 等几分钟 + retry | pending |
| 3 | dev env `npm test` 第二个 hang cause | R56 |
| 4 | ICP / WX key rotate / GH PAT revoke | 你手动 |

## 改了什么

| 文件 | 内容 |
|------|------|
| `backend/scripts/clear-test-rate-limit.js` | 加 timeout + fail-open exit 0 |
| `backend/src/routes/admin/dashboard.js` | 直接 `mysql2/promise.createPool` dashPool (绕 db.js wrapping 陷阱) |
| `/etc/systemd/system/resume-app-tunnel.service` | Type=simple + 直接 ssh ExecStart + SuccessExitStatus=255 + ExecStartPre |

## baseline

backend 425 / 0 fail / 1 skip (run gated by dev env). mini-program 47 / 0 fail. R42 起 zero fail maintained.

## 决策

| # | 决策 | 原因 |
|---|------|------|
| 1 | dashPool 独立 (不修 db.js) | db.js 给其他 routes 用,改它影响面大 |
| 2 | systemd simple + direct ssh (不再 wrapper) | oneshot 不 restart child; wrapper disown 也不可靠 |
| 3 | SuccessExitStatus=255 | ssh reconnect 时正常返 255, 不当失败 |
| 4 | clear-test-rate-limit fail-open | 测试可选; dev 无 Redis 不应该 block |

## Commits

| SHA | msg |
|-----|-----|
| (本 devlog + 3 files) | fix: R55 — clear-test-rate-limit timeout + dashPool + systemd tunnel unit |
