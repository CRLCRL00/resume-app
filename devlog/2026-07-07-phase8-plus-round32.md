# 开发日志 — 2026-07-07（Phase 8+ Round 32）

> 阶段：8+ Round 32 — ADF hardening
> 前置：[2026-07-06-phase8-plus-round31.md](../devlog/2026-07-06-phase8-plus-round31.md)

## 目标

3 hardening 项：
E. Chaos 测试（DB/Redis/LLM 故障 fail-open 验证）
F. Alertmanager Slack webhook 通知 + dedupe
G. ESLint 接入（backend + mini-program）

## 最终结果

| 项 | 状态 |
|----|------|
| E Chaos tests | ✅ 7/7 fail-open 路径全过 |
| F Slack notifier | ✅ 5/5 + 端到端 + dedupe |
| G ESLint | ✅ backend 0 err/17 warn，mp 0 err/5 warn |
| **npm test 3x** | ✅ **276 / 273 pass / 2 fail / 1 skip** × 3 |

baseline 264 → 276（+12：chaos 7 + alertRouter 5）。2 fail pre-existing authLockout。

## 改动详情

### E — Chaos 测试

`backend/tests/chaos/helpers/chaosStubs.js`（新）：
- `installRedis()` — 全方法 throw 客户端
- `installDb()` — pool.query 拒绝
- `installLlm({delayMs, shouldFail})` — Promise + AbortSignal 兼容
- `restoreAll()` — 删 require.cache 注入

`backend/tests/chaos/failOpen.test.js`（新，7 测）：

| # | 场景 | 期望 |
|---|------|------|
| 1 | Redis down × sliding 限流 | fail-open + 二次请求仍响应 |
| 2 | Redis down × token verify | middleware 继续放行 |
| 3 | MySQL query 失败 | 不 hang，body 无 stack |
| 4 | LLM 异常 | 502，无 stack leak |
| 5 | LLM 10s timeout | AbortSignal 1s 内 abort，502 |
| 6 | Redis SET/DEL 失败 × lockout | log warn 不 500 |
| 7 | DB + Redis 同时挂 | `/api/health` 响应，不 hang |

总耗时 1.8s（远低于 30s 预算）。

⚠️ **chaos 发现 4 个 fail-open 隐患**（devlog 留待 follow-up）：
1. `/api/health/ready` 不 defensive 检查 `redis.ping` 是否 function（malformed stub 会 crash）
2. `userAuth` 的 isRevoked fail-open 无 logger.warn（静默放行被 revoke token，observability gap）
3. `/api/auth/login` 500 不可区分 DB down / wechat down / code 校验失败（可接受但 ops 难诊断）
4. `/api/health/live` 永远 200（k8s liveness 不会重启 pod 即使 infra 全挂 — 行为正确，但需 ops 知情）

### F — Slack Notifier + Dedupe

`backend/src/services/alertNotifier.js`（新）：
- `notifySlack({webhookUrl, channel, text, blocks})` 
- 5s AbortController timeout，never throws
- 返 `{ok, status|error}`

`backend/src/services/alertRouter.js`（新）：
- `evaluateAndNotify({rules, fired})` — severity 路由（critical → Slack，warning → 默认）
- **dedupe**：Redis `SET key NX EX 3600`，60min 内同名 alert 不重复通知
- mute list 支持 + securityLog 审计
- `forceNotify()` for ops 手动触发

`backend/src/routes/metricsAlerts.js`（改）：
- 注入 `evaluateAndNotify`（test env 短路）
- `POST /api/internal/metrics/alerts/test-notify`（ALERT_TOKEN auth，ops 测试用）

`backend/src/routes/alertWebhook.js`（新）：
- `POST /api/internal/alerts/webhook/slack` — incoming 接收
- Slash command `/alerts status` → 返当前 fired 数
- HMAC `sha256=` 验签（复用 `routes/alerts.js` 模式）
- rawBodyMiddleware + urlEncodedMiddleware

`backend/src/config/index.js` + `.env.example`：
- `SLACK_WEBHOOK_URL`、`SLACK_DEFAULT_CHANNEL`、`SLACK_HMAC_SECRET`、`ALERT_DEDUPE_TTL_MS`

测 `backend/tests/alertRouter.test.js`（5）：
- critical alert → Slack 一次（fetch 捕获 URL+payload）
- 60min 内同 alert → 第二次 skipped
- warning → 通知
- 缺 `SLACK_WEBHOOK_URL` → 返 `{ok:false, reason:'...'}`，不 crash
- Slack 返 500 → 通知 ok:false，caller 继续

样例 Slack payload：
```json
{"channel":"#alerts","text":"[CRITICAL] HighErrorRate (value=250, threshold=100) — HTTP 5xx error rate > 5% for 5m"}
```

`backend/src/app.js` mount alertWebhookRouter at `/api/internal/alerts`。

### G — ESLint

`backend/.eslintrc.json` + `backend/.eslintignore`（新）：
- base `eslint:recommended`
- 14 自定义规则（保守）：
  - error: `eqeqeq:smart`, `no-var`, `prefer-const`, `semi:always`, `quotes:single+templates`, `no-eval`, `no-implied-eval`, `no-empty:allowEmptyCatch`
  - warn: `no-unused-vars`（`_` 前缀 opt-out）, `no-multi-spaces`, `no-trailing-spaces`, `no-control-regex`, `no-dupe-keys`
  - off: `no-console`（codebase 用）, `no-process-exit`（lifecycle.js 故意）
- 忽略 `tests/`（决策：fixtures 含真实数据风格，不强一致）

`mini-program/.eslintrc.json`（新）：
- 同 base + WeChat globals（`wx`, `App`, `Page`, `Component`, `Behavior`, `getApp`, `getCurrentPages`）

`backend/package.json` + `mini-program/package.json`（改）：
- devDep `eslint@^8.57.0`（v8 末版稳定，避开 v9 flat-config）
- scripts: `lint`、`lint:fix`

`package.json`（root）：
- top-level `lint` / `lint:fix` 链 → backend + mini-program

`.github/workflows/backend-ci.yml`（改）：
- 加 `npm run lint` step（两个 sub-project），在 `npm ci` 后、`run-tests` 前
- mp install fallback `npm install`（lockfile drift 容错）

`docs/eslint.md`（新）：规则总览 / 范围决策 / 已知 warning 列表 / 如何加规则。

⚠️ **现有代码 lint 状态**：
- backend: 0 err / 17 warn（unused imports + 1 个 openapi.js duplicate key 真 bug）
- mp: 0 err / 5 warn

保留 warn 故意不修，避免一次性 PR 引入语义改动；后续按模块跟进。

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 276 | 273 | 2 | 1 |
| 2 | 276 | 273 | 2 | 1 |
| 3 | 276 | 273 | 2 | 1 |

baseline 264 → 276（+12）。0 新 fail。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | E chaos 用 require.cache stub | 已有模式；不引外部工具 |
| 2 | E 测 7 场景不测每端点 | 选 6 个 critical（auth/generate/health/internal） |
| 3 | F dedupe 60min TTL | 避免 alert storm 刷屏 |
| 4 | F Slack notifier never throws | 单点失败不拖累 alert router |
| 5 | G tests/ 不 lint | 避免 fixtures 假阳性；后续按目录覆盖 |
| 6 | G warn 不 error | 现有代码无破坏；后续逐项修 |
| 7 | G ESLint v8 不用 v9 | v9 flat-config 破坏 8 生态 |
| 8 | F webhook url-encoded 而非 json | Slack slash command 默认 form-encoded |

## 风险

| 风险 | 缓解 |
|------|------|
| E fail-open 隐患 #1-#4 | 列 follow-up；不改源 |
| F SLACK_WEBHOOK_URL 误配 | 缺 → log warn + 静默，不误报 |
| F dedupe key 跨 pod 不共享（多实例） | 单实例 OK；多 pod 用 Redis pub/sub 替代 |
| G 17 warn 累积 | docs/eslint.md 跟踪；CI 暂不 fail-on-warn |
| G mini-program 锁文件 drift | workflow fallback `npm install` |

## 已知 Follow-up

| # | 项 | 优先级 |
|---|----|--------|
| 1 | health.js defensive `typeof redis.ping === 'function'` | 中 |
| 2 | userAuth isRevoked fail-open 加 logger.warn | 中 |
| 3 | openapi.js duplicate path key 真 bug | 高 |
| 4 | 把 unused imports warn 降为零（按文件） | 低 |
| 5 | 多 pod 场景 alert dedupe 改 Redis pub/sub | 低 |

## Commits

| SHA | msg |
|-----|-----|
| `3563063` | test(chaos): fail-open paths when DB/Redis/LLM down (7 scenarios) |
| `56d2bcb` | feat(alerts): Slack webhook notifier + dedupe + HMAC-signed incoming |
| `0fb6076` | feat(lint): ESLint 8 setup (backend + mini-program) with conservative recommended+ rules |
| `754485a` | ci: add npm run lint step to backend CI workflow |
