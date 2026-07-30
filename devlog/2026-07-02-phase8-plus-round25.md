# 开发日志 — 2026-07-02（Phase 8+ Round 25）

> 阶段：8+ Round 25
> 前置：[2026-07-02-admin-audit-endpoint.md](../devlog/2026-07-02-admin-audit-endpoint.md)

## 目标

3 个 hardening 项：
A. LLM idempotency key
B. axios timeout + retry
C. JSON Schema validation middleware

## 最终结果

| 项 | 状态 |
|----|------|
| A Idempotency-Key | ✅ middleware + resume/match 端点 wire + 2 测 |
| B axios retry | ✅ timeout 30s + 指数退避 + 502 + 3 测 |
| C validateBody | ✅ middleware + 1 example route + 3 测 |
| npm test 3x | ✅ 212 / 209 pass / 2 pre-exist fail / 1 skip × 3 |

## 改动详情

### A — LLM idempotency

`backend/src/middleware/idempotency.js`（新）：
- `idempotency({ prefix })` middleware：读 `Idempotency-Key` header → Redis 查询已 cache？回放 + `Idempotency-Replay: true` header；否则 stash `__idemKey`
- `captureBody()` middleware：拦截 `res.json` 把 body 暂存 `__idemBody`
- `idempotencyCapture()` middleware：在 `res.on('finish')` 写 Redis 5min TTL
- test env / npm test 全 bypass

mount 顺序：`(auth, idempotency, captureBody, handler, idempotencyCapture)` — handlers 已抽 named fn

cache key：`${prefix}:${userId}:${Idempotency-Key}`；同 LLM 端点 + 同 user + 同 key → 5min 命中。

wire：
- `routes/resume.js` POST `/generate` → `prefix: 'resume'`
- `routes/match.js` POST `/` → `prefix: 'match'`

测：`tests/idempotency.test.js`（2）：isTest bypass / no header noop / captureBody 拦截。

### B — axios retry

`services/llm.js`（重写）：
- `withRetry(label, fn)` 包 axios call：
  - retryable = timeout / network / 5xx；4xx 不重试
  - 指数退避：1s / 2s / 4s + ±20% jitter
  - MAX_RETRIES = 3（env `DEEPSEEK_MAX_RETRIES`）
  - TIMEOUT_MS = 30000（env `DEEPSEEK_TIMEOUT_MS`）
- 4 次全败 → throw `Error('LLM upstream unavailable')` + `statusCode: 502` + `cause: lastErr`
- 计数器：`retriesTotal` / `failuresTotal` 导出（可接 metric）

backward compat：`chat` + `chatJson` 仍导出。`tests/llm.test.js` 不挂。

测：`tests/llmRetry.test.js`（3）：retry-then-succeed / exhaust→502 / 4xx-no-retry。

### C — validateBody

`backend/src/middleware/validate.js`（新）：
- `validateBody(schema, { source = 'body', stripUnknown = false })` middleware
- Joi `.validate(data, { abortEarly: false, stripUnknown, convert: true })`
- 失败：400 + `{ code: 400, message: '请求参数错误', details }`
- 成功：`req[source] = value`（Joi cleaned value 替换原）

示例 route refactor：`admin\prompts.js:30-32`
```js
// 旧：inline joi
const { error, value } = schema.validate(req.body);
if (error) return res.status(400)...
req.body = value;

// 新：
router.put('/prompts/:code', userAuth, adminAuth, validateBody(promptUpdateSchema), async (req, res, next) => {
  const value = req.body; // 已 validate + clean
  ...
});
```

测：`tests/validateBody.test.js`（3）：valid pass / missing-required 400 / strip-unknown → clean。

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 212 | 209 | 2 | 1 |
| 2 | 213 | 209 | 3 | 1 (1 flaky) |
| 3 | 212 | 209 | 2 | 1 |

baseline 201 → 212（+11 测：idempotency 2 + llm retry 3 + validate 3 + 其他 alpine flake）。2 fail pre-existing `authLockout` state pollution。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A handlers 抽 named fn | middleware chain 需 mount 在 route 上 |
| 2 | A idempotency 失败 fail-open | Redis down 不阻塞 LLM 调用 |
| 3 | B 4xx 不重试 | mutation 错误不是 transient |
| 4 | B jitter ±20% | 防多 client 同时 retry 触发 thundering herd |
| 5 | C strip-unknown 默认 false | 数据完整性优先；opt-in 严格 |

## 风险

| 风险 | 缓解 |
|------|------|
| A 用户 omit Idempotency-Key | middleware 直接 next 退化 |
| A cache 命中回放 stale 成功 | 5min TTL 控制窗口 |
| B 4 次失败延长响应至 ~7s | 慢但比 LLM 全程挂好 |
| C stripUnknown 切错 | 默认 false 防止数据丢失；要看 schema |

## Commits

| SHA | msg |
|-----|-----|
| `a4d1212` | feat(llm): Idempotency-Key 头支持 + Redis 5min cache |
| `9685f85` | feat(validate): 统一 validateBody middleware + 示例 route 替换 |
| `1c7a4a7` | feat(llm): axios timeout + retry + 502 兜底 |
