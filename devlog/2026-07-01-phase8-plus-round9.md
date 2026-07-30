# 开发日志 — 2026-07-01（Phase 8+ Round 9）

> 阶段：8+ (备份验证 + JWT 黑名单 + OpenAPI + Prometheus)
> 前置：[2026-07-01-phase8-plus-round8.md](../devlog/2026-07-01-phase8-plus-round8.md)

## 目标

4 个 hardening 项：
A1. 备份 verify cron
A2. JWT 黑名单 + logout
B. OpenAPI 补全 schemas
C. Prometheus metrics

## 最终结果

| 项 | 状态 |
|----|------|
| A1 verify-backup.sh + cron 04:00 | ✅ 验过 1 backup (7 tables, 5658B) |
| A2 JWT 黑名单 | ✅ logout 200 + blacklist verify 1002 |
| B OpenAPI 26 paths / 11 schemas | ✅ |
| C /api/internal/metrics | ✅ Prometheus 默认 + 业务 metric |
| npm test 3x | ✅ 120/121 × 3 绿 |

## 改动详情

### A1 — 备份 verify cron

`scripts/verify-backup.sh`:
- 检查最新备份 > 1KB
- zcat 解压 + grep CREATE TABLE ≥ 5
- 失败码分别 exit 1/2/3/4
- log → `/var/log/resume-app-backup-verify.log`

cron 04:00 每日：
```
0 4 * * * root /usr/local/bin/verify-resume-app-backup.sh
```

每天：
- 03:00 backup.sh
- 04:00 verify-backup.sh

### A2 — JWT 黑名单

`middleware/auth.js`:
```js
async function userAuth(req, res, next) {
  ...
  const blacklisted = await safeCheckBlacklist(token);
  if (blacklisted) return next(new AppError(1002, 'token revoked', 401));
  ...
}
async function safeCheckBlacklist(token) {
  try { return !!(await redis.get(`jwt:blacklist:${token}`)); }
  catch (_e) { return false; } // fail-open
}
```

`routes/auth.js` 加 `POST /api/auth/logout`：
```js
router.post('/logout', userAuth, async (req, res, next) => {
  await redis.set(`jwt:blacklist:${token}`, '1', 'EX', 30 * 24 * 3600);
  securityLog.recordSync('logout', req, ...);
  res.json({ code: 0, data: { revoked: true } });
});
```

### B — OpenAPI 补全

从 19 paths / 1 schema 升级到 **26 paths / 11 schemas**：
- 新增 schemas：`LoginRequest/Response`、`ResumeSaveRequest`、`MatchRequest/Response/Result`、`GenerateRequest/Response`、`JobCreateRequest`、`ErrorResponse`、`StandardResponse`
- 每个 endpoint：
  - `requestBody.content` 用 `$ref` 引用 schema
  - `responses` 多状态码：200/400/401/403/429/502
- `/api/health` / `/api/legal/*` 加 `security: []` 标记公开

### C — Prometheus

`routes/metrics.js`:
```js
const register = new client.Registry();
client.collectDefaultMetrics({ register }); // CPU/mem/...
const llmCalls = new client.Counter({ name: 'llm_calls_total', labelNames: ['call_path','status'] });
const llmTokens = new client.Counter({ name: 'llm_tokens_total', labelNames: ['call_path','kind'] });

router.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.send(await register.metrics());
});
```

`services/llm.js` 接入：
```js
metrics.llmCalls.inc({ call_path: callPath, status: 'ok' });
metrics.llmTokens.inc({ call_path: callPath, kind: 'prompt' }, usage.prompt_tokens);
metrics.llmTokens.inc({ call_path: callPath, kind: 'total' }, usage.total_tokens);
```

## 服务部署 verify

```
$ curl /api/internal/metrics
# HELP process_cpu_user_seconds_total ...
process_cpu_user_seconds_total 0.111697
process_resident_memory_bytes 97996800
...

$ curl POST /auth/logout (JWT)
{"code":0,"data":{"revoked":true}}

$ curl GET /resume/current (same JWT)
{"code":1002,"message":"token revoked"}  ✓ blacklist works
```

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A1 cron 04:00 | 备份后 1 小时验，给 OS buffer 时间 |
| 2 | A2 黑名单 key TTL 30 天 | JWT 默认 30 天；过期即 cleanup |
| 3 | A2 redis fail-open | 黑名单故障不该误杀合法 user |
| 4 | B OpenAPI hand-rolled | 简单项目不动 swagger-jsdoc |
| 5 | C 默认 collect + 业务 2 metric | 先够用；后续按需加 p95 / req 时长 |

## 风险

| 风险 | 缓解 |
|------|------|
| 备份 verify 失败无监控 | 加 `/api/internal/alert` 接 webhook（已 Round 6）|
| JWT 黑名单 redis 挂 | fail-open（用户能继续用，安全 ↔ 可用性 trade-off）|
| prom 内存涨 | 默认 metric 数有限；后续按需扩 |
| OpenAPI 文档过期 | 手维护触发 spec 漂移；下轮上 swagger-jsdoc 自动同步 |

## Commits

`{pending}` — round 9
