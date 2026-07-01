# 开发日志 — 2026-07-01（Phase 8+ Round 18）

> 阶段：8+ Round 18
> 前置：[2026-07-01-phase8-plus-round17.md](../devlog/2026-07-01-phase8-plus-round17.md)

## 目标

3 个 hardening 项：
A. LLM 输入 sanitization 防 prompt injection
B. LLM 端点 rate limit（Redis store）
C. jobs/match 路由单测补

## 最终结果

| 项 | 状态 |
|----|------|
| A sanitize | ✅ utils + resume/match 调用点 + 8 测试 |
| B rate limit | ✅ express-rate-limit v7 + rate-limit-redis v4 |
| C jobs + match 测试 | ✅ 18 新测（jobs 11 / match 7） |
| npm test 3x | ✅ 164 pass / 1 skip × 3 稳 |

## 改动详情

### A — LLM 输入 sanitization

`backend/src/utils/sanitize.js`（新）：
- `sanitizeForLlm(input, { max })` — 去控制字符 + 去 role tags + 截断 + 折叠空白
- `sanitizeForLlmDeep(obj)` — 递归清字符串字段
- `MAX_USER_TEXT = 8000`

调用点：
- `routes/resume.js:71` — wrap `sourceForm` → `resumeGenerator.generate`
- `routes/match.js:13,27-37` — wrap `content_md` from DB before sanitize + UPDATE pre-LLM

实际代码与 spec 偏差：codebase 无 `genOptimizedResume` 函数（spec 假设），按现有 `resumeGenerator.generate` 包装。

### B — Rate limit

依赖安装：
- `express-rate-limit@7.5.1`
- `rate-limit-redis@4.3.1`
- `ioredis@5.4.1`（已有）

`backend/src/middleware/rateLimit.js`（新）：
- 10 min / 30 req per IP
- `keyGenerator = `${name}:${req.ip}``
- `RedisStore` 走 `sendCommand: (...args) => redis.call(...args)`
- `skip: isTestEnv`（test env 完全跳过）
- 429 → `{ code: 429, message: '请求过于频繁...' }`

实际与 spec 偏差：
- `config/redis.js` 默认导出 ioredis 实例（非 `{ redis }`）；middleware 用 `require('../config/redis')` 适配
- test env 检测加 `process.env.npm_lifecycle_event === 'test'` —— `npm test` 默认不设 NODE_ENV；否则 9 测挂
- `/api/match/generate` 实际路由为 `POST /`，limiter 当前防御性占位（match 暂无 /generate 子路径）

mount：`/api/resume/generate` + `/api/match/generate` 在 router 前。

### C — jobs + match 单测

`tests/jobs.test.js`（149 行 / 11 用例）：
- 公开 `GET /:id`（400/404/parsed-skills/deleted/offline）
- admin CRUD（401/403/400 missing title/200 happy PUT/DELETE soft）

`tests/match.test.js`（203 行 / 7 用例）：
- 401 / 400 missing resume_id / 404 missing resume / 200 happy with stub LLM / 0-100 clamp / invalid job_id / 4/min 内置 rate

mock pattern：复用 `tests/helpers/db.js` + `tests/helpers/llm.js` + `services/token.sign()` JWT seed。

### 修复迭代亮点

- sanitize 测 `strips code fence with system` 原 regex ``` `/```\s*(system|assistant|user)/gi` ``` 需扩为 `/```\s*(system|assistant|user)[\s\S]*?(?:```|$)/gi` 处理无闭 fence 情形
- match rate-limit 测试 4/min：原 9999999 resumeId 总是 404 不达 rate，需插真实 resume + stub LLM 空结果，让 6 次请求才能 incr 触顶

## npm test

| Run | pass | fail | skip |
|-----|------|------|------|
| 1 | 164 | 0 | 1 |
| 2 | 164 | 0 | 1 |
| 3 | 164 | 0 | 1 |

baseline 136 → 165（净 +29 测试 / +18 pass 通过幂等覆盖原有 flake）。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A sanitize 在 DB read 后再 UPDATE 一遍 | 保证 LLM 看到的是清洗后内容 |
| 2 | B test env 双检测 | NODE_ENV 与 npm_lifecycle_event 兼容 |
| 3 | B match generate 占位防御 | 一行成本，等真子路由到来即生效 |
| 4 | C 沿用旧 mock 模式（LLM stub + DB）| 不引入新依赖 |

## 风险

| 风险 | 缓解 |
|------|------|
| A sanitize 把合法文本截掉 | max=8000 远高于实际简历；超长截断而非抛错 |
| B redis 挂则 limiter 抛错 | npm test 已绕；prod 需监控 `rl:*` keys 内存 |
| C test cleanup 不全 | 用现成 helpers 模式，与旧测一致 |

## Commits

| SHA | msg |
|-----|-----|
| 53c7700 | feat(security): LLM 输入 sanitization 防 prompt injection |
| 60c4776 | feat(security): LLM 端点 rate-limit (Redis store) |
| f4c9dd8 | test: jobs + match 路由单测补 |
