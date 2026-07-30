# 混沌测试场景 (R32)

> TL;DR：7 个 in-process 故障注入（chaos stubs），验证 DB / Redis / LLM / rate-limit / lockout 失败时**不挂、不漏错误信息、后续请求可恢复**。

## 测试文件

`backend/tests/chaos/failOpen.test.js` + `tests/chaos/helpers/chaosStubs.js`

每个 test 步骤：
1. 调 `chaos.installXxx()` 注入桩
2. `require('../src/app')` **之后**才能让桩生效
3. 跑 supertest，断言不挂 + 不漏
4. `chaos.restoreAll()` 清理（`test.afterEach`）

## 7 个场景

| # | 注入 | 中间件 / 路径 | 期望 |
|---|------|---------------|------|
| 1 | Redis down on sliding rate limit | `middleware/slidingRateLimit.js` | fail-open，请求 4xx/5xx 不挂 |
| 2 | MySQL down on auth login | `services/wechat.code2session` 之后 | 500 from errorHandler，不返 stack |
| 3 | LLM 5xx | `services/llm.chat` | resume/generate 返 502，subsequent ok |
| 4 | LLM timeout | `services/llm.chat` hang 2s | AbortController 触发 504 |
| 5 | DB pool 全占用 | `config/db.getConnection` reject | 503 Service Unavailable |
| 6 | Admin auth middleware Redis 挂 | `middleware/authLockout` | fail-open 放过（保守） |
| 7 | 慢查询超过 5s | `db.query` 5s 后 resolve | 客户端 timeout / 中间件 504 |

具体断言看 `failOpen.test.js`。每个 case 都断言：

- 状态码 ∈ {400, 500, 502, 503, 504}
- 响应 body **不含** stack trace / SQL / connection string
- 第二个请求仍能处理（middleware 恢复了）

## Fail-open 行为汇总

| 模块 | 失败行为 | 文档 |
|------|----------|------|
| `slidingRateLimit` | 放行（不阻挡） | `middleware/slidingRateLimit.js` |
| `authLockout` (Redis) | 放行（保守） | `middleware/authLockout.js` |
| `twoFactor.isVerified` | 返 false → step-up 强制 | `services/twoFactor.js` |
| `alertRouter.dedupe` | fail-open（双发好过漏发） | `services/alertRouter.js` |
| `idempotency` (Redis) | fail-closed（拒绝） | `middleware/idempotency.js` |
| `queryMetrics.recordQuery` | 静默吞掉 metric 错误 | `services/queryMetrics.js` |
| `logger.*` | stdout 兜底 | `utils/logger.js` |

**fail-open vs fail-closed 选择标准**：
- **fail-open**：rate limit / dedupe / 读路径（双发好过漏发；UX > 严格）
- **fail-closed**：idempotency / 写信任路径（双发 = 业务错）

## 跑测试

```bash
cd backend
node --test tests/chaos/
```

## 已知 gaps + follow-up

| Gap | 影响 | 优先级 |
|-----|------|--------|
| 没有真实 LLM provider 故障注入（mock 层就 500） | 缺真实网络断开 / DNS 失败场景 | 中 |
| 没有 PM2 多 worker chaos | 单进程桩，多 worker 行为未验 | 低 |
| 没有 DB 主从切换 | 切主从的真实延迟未测 | 低 |
| 没有 cert / TLS 链路故障 | serveo tunnel 挂掉行为未测 | 低 |
| Redis 集群模式 chaos | 集群分片故障未测 | 低 |

## 加新场景

1. `tests/chaos/helpers/chaosStubs.js` 加 `installXxx()` / `restoreXxx()`
2. `failOpen.test.js` 加新 test：
   ```js
   test('chaos #N: <描述> → <期望行为>', async () => {
     chaos.installXxx();
     const app = createApp();
     const r = await request(app).get('/api/...');
     assert.ok([400, 500].includes(r.status));
     assert.doesNotMatch(r.text, /stack|sql|connection/i);
   });
   ```
3. 不漏检：r.text 不应含 stack / SQL / 密码字段
4. 加到 README 表格
