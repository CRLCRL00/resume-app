# npm test Hang 修复 设计

> 阶段：6+（上线打磨后）
> 前置：[2026-06-29-phase6-verify.md](2026-06-29-phase6-verify.md) — `npm test` 全量仍卡
> 决策方案：A+E+D 混合（用户选）

## 目标

`cd backend && npm test` 在 30 秒内正常退出且全部用例通过（当前：60s+ 不退）。

## 根因（已确认）

1. **跨文件池冲突**：`node --test tests/*.test.js` 默认并发执行文件。每个 `test.after` 调用 `pool.end()` 在 singleton 上 → 第一个退出的文件永久关掉共享池 → 后续 / 并发文件查询卡死。
2. **rateLimit INCR 漏**：`service-matchService.test.js` 5 个测试共用 `match:${TEST_USER}` key，INCR 不清 → 第 5 次触发 429。
3. **Node `--test` 并发**：加剧 #1。

## 架构

| 层 | 文件 | 改动 |
|----|------|------|
| 工厂 | `src/config/db.js` | 加 `createPool()`，默认仍导 singleton |
| 工厂 | `src/config/redis.js` | 加 `createRedis()`，默认仍导 singleton |
| Helper | `tests/helpers/db.js`（新建） | 懒初始化每文件 pool/redis + `cleanup()` |
| Script | `package.json` | `test` 加 `--test-force-exit` |
| 测试文件 | 16+ 文件 | 改用 helper |

**不变**：singleton 仍导（向后兼容 app/路由）；路由 `require('../config/db')` 继续拿 singleton。

## 组件

### `src/config/db.js`

```js
const mysql = require('mysql2/promise');
const config = require('./index');

function createPool() {
  return mysql.createPool({
    host: config.DB.host, port: config.DB.port,
    user: config.DB.user, password: config.DB.password,
    database: config.DB.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    dateStrings: false,
  });
}

const defaultPool = createPool();

module.exports = defaultPool;
module.exports.createPool = createPool;
```

> mysql2 pool 是普通对象，挂 `createPool` 属性安全。

### `src/config/redis.js`

```js
const Redis = require('ioredis');
const config = require('./index');

function createRedis() {
  return new Redis({
    host: config.REDIS.host,
    port: config.REDIS.port,
    password: config.REDIS.password || undefined,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

const defaultRedis = createRedis();

defaultRedis.on('error', (err) => {
  console.error('[redis] error:', err.message);
});

module.exports = defaultRedis;
module.exports.createRedis = createRedis;
```

### `tests/helpers/db.js`（新建）

```js
const { createPool } = require('../../src/config/db');
const { createRedis } = require('../../src/config/redis');

let pool = null;
let redis = null;

function getPool() {
  if (!pool) pool = createPool();
  return pool;
}

function getRedis() {
  if (!redis) redis = createRedis();
  return redis;
}

async function cleanup() {
  if (pool) {
    try { await pool.end(); } catch {}
    pool = null;
  }
  if (redis) {
    try { await redis.quit(); } catch {}
    redis = null;
  }
}

module.exports = { getPool, getRedis, cleanup };
```

> 懒初始化：第一次 `getPool()` 才创建。`cleanup()` 关 THIS 文件的 pool/redis，不动 singleton。

### 测试文件改法

**Before**：
```js
const pool = require('../src/config/db');
test.after(async () => { await pool.end(); await redis.quit(); });
```

**After**：
```js
const { getPool: pool, getRedis: redis, cleanup } = require('./helpers/db');
test.after(cleanup);
```

> 不直接调 `require('../src/config/db').createPool()` — 用 helper 统一管生命周期。

### `package.json`

```diff
- "test": "node --test tests/*.test.js",
+ "test": "node --test --test-force-exit tests/*.test.js",
```

`--test-force-exit`（Node 22+）确保 Node 在测试完成后立即退出，不管挂起句柄。

### rateLimit beforeEach（仅 matchService）

`tests/service-matchService.test.js` 顶部加：

```js
const RATE_KEYS = [
  `match:${TEST_USER}`,
  'match:batch:*',  // wait — wildcard not supported here, list explicit
];

test.beforeEach(async () => {
  await redis.del(`match:${TEST_USER}`);
  // matches batch cache keys — explicit per test below
});
```

实际：在每个 `test()` 体内清对应 `match:batch:${userId}:${resumeId}`（已存在体内），并把 `match:${TEST_USER}` 提到 `beforeEach` 统一清。

## 受影响文件

| 文件 | 当前状态 | 改动 |
|------|----------|------|
| `src/config/db.js` | 纯 singleton | 加 `createPool()` |
| `src/config/redis.js` | 纯 singleton | 加 `createRedis()` |
| `tests/helpers/db.js` | 不存在 | 新建 |
| `package.json` | `test` script | 加 `--test-force-exit` |
| `tests/health.test.js` | empty test.after | 不需要 DB，不动 |
| `tests/resume-save.test.js` | test.after end singleton | 改 helper |
| `tests/resume-current.test.js` | test.after end singleton | 改 helper |
| `tests/route-auth.test.js` | test.after end singleton | 改 helper |
| `tests/route-test-llm.test.js` | test.after end singleton | 改 helper |
| `tests/route-admin-placeholder.test.js` | test.after end singleton | 改 helper |
| `tests/service-matchService.test.js` | test.after end singleton | 改 helper + beforeEach 清 key |
| `tests/route-match.test.js` | 无 test.after（用 db） | 加 helper |
| `tests/route-resume-generate-llm.test.js` | 无 test.after（用 db） | 加 helper |
| `tests/route-jobs-detail.test.js` | 无 test.after（用 db） | 加 helper |
| `tests/middleware-auth.test.js` | 用 db | 加 helper |
| `tests/middleware-admin-auth.test.js` | 用 db | 加 helper |
| `tests/middleware-validate-resume.test.js` | 用 db | 加 helper |
| `tests/admin-jobs-crud.test.js` | 用 db | 加 helper |
| `tests/admin-logs.test.js` | 用 db | 加 helper |
| `tests/admin-prompts-crud.test.js` | 用 db | 加 helper |
| `tests/service-adminLog.test.js` | 用 db | 加 helper |
| `tests/service-jobFilter.test.js` | 用 db | 加 helper |
| `tests/db.test.js` | 用 db | 加 helper |
| `tests/db-init.test.js` | 用 db | 加 helper |
| `tests/redis.test.js` | 用 redis | 加 helper |
| `tests/service-rateLimit.test.js` | 用 redis | 加 helper |

~25 文件改动（不含纯单测：logger/token/wechat/llm/matchPrompt/resumePrompt/resumeGenerator/resumeTemplate/config）。

## 数据流

```
[ File A 加载 ]
  │
  ├─ require('./helpers/db') → 懒 pool/redis
  ├─ require('../src/app') → singleton (用于 createApp)
  │     └─ 路由内部仍 require('../config/db') → singleton
  │
  ├─ 测试 query → helper.getPool() → FILE_A_POOL
  ├─ 路由 query → singleton
  │
  └─ test.after(cleanup) → 关 FILE_A_POOL / FILE_A_REDIS
                            singleton 永远没人 end
                               ↓
                          进程退出（--test-force-exit）
```

并发跑时，每个文件有独立 pool/redis。singleton 是连接池（10 conn）容纳路由调用。

## 错误处理

| 场景 | 行为 |
|------|------|
| `createPool()` 失败 | 文件加载 throw → Node 标 fail 退出 |
| helper pool 已 end 后再查询 | mysql2 抛错 → 测试失败（明示） |
| `--test-force-exit` 仍有挂句柄 | 进程杀，无错误（兜底） |
| singleton 真有死连接（极端） | Node 默认 10s 超时后 force-exit |

## 测试（验收）

```bash
cd backend
# 1. 单文件 OK（baseline 不变）
node --test tests/health.test.js      # < 5s
# 2. rateLimit 文件 OK
node --test tests/service-rateLimit.test.js  # < 5s
# 3. matchService 5 测试全过（rateLimit 不漏）
node --test tests/service-matchService.test.js  # < 12s, 5/5
# 4. 全量跑通且退出
time npm test                         # < 30s, exit 0
# 5. 重复跑一致
for i in 1 2 3; do time npm test; done  # 都 < 30s
```

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A+E+D 混合（用户选） | 根治 + 兜底 |
| 2 | Helper 模式而非直接 `createPool()` 调用 | 统一生命周期，少改动 |
| 3 | singleton 不被任何测试 end | 跨文件并发安全 |
| 4 | `--test-force-exit` 进 package.json | Node 22+ 原生支持，不改 node options |
| 5 | rateLimit beforeEach 只改 matchService 一文件 | 仅该文件实测漏，其他未触发 |

## 不做

- 不换测试框架（保持 node:test）
- 不动 route 内部用 pool 的方式（用 singleton）
- 不修 `npm run dev`、CI 配置（后续 Phase 7+ 再看）
- 不修非测试相关代码

## 风险

| 风险 | 缓解 |
|------|------|
| mysql2 pool 对象挂 `createPool` 属性有兼容性 | mysql2 pool 是普通 JS 对象，无 createPool 字段，安全 |
| `--test-force-exit` 在 < Node 22 不可用 | 项目 engine `>=20`，需 Node 22+ 才能跑 npm test。`README.md` 加提示 |
| helper 引入新文件路径，需 1+ 文件改动 | 接受 |
