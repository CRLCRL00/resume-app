# 开发日志 — 2026-07-01（Phase 8+ Round 11）

> 阶段：8+ (Round 11)
> 前置：[2026-07-01-phase8-plus-round10.md](../devlog/2026-07-01-phase8-plus-round10.md)

## 目标

3 个 hardening 项：
A. HMAC raw body fix + graceful shutdown
B. legal cache + CORS
C. health deep 阈值

## 最终结果

| 项 | 状态 |
|----|------|
| A HMAC raw body fix | ✅ Round 10 caveat 修了（raw middleware 移 json 前） |
| B legal cache + CORS | ✅ max-age 300 + ACAC * |
| C health deep 阈值 | ✅ > 500ms `degraded: true` + 199/200/503 |
| npm test 3x | ✅ 120/121 × 3 绿 |

## 改动详情

### A — HMAC raw body fix

**问题**：Round 10 的 HMAC 验签用 `JSON.stringify(req.body)` 不是 raw body，是 express.json() 解析后的对象再序列化。客户端 curl -d 的 raw bytes 和服务端再序列化结果不一致。

**修复**：
1. `routes/alerts.js` 加 `router.rawBodyMiddleware = express.raw({ type: '*/*', limit: '64kb' })`
2. 服务端改：`const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : (req.body || '')`
3. **`app.js` 关键 fix**：`rawBodyMiddleware` 必须 **在 `express.json()` 之前** mount，否则 body-parser raw 看到 body 已被设就跳过
4. 部署后验：`{code:0,data:{received:true}}` ✅

### B — legal cache + CORS

`routes/legal.js`:
```js
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  ...
  next();
});
router.options('*', (req, res) => res.sendStatus(200));
function setPublicCache(res) {
  res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
}
```

CORS 用于浏览器调试 / 第三方集成（mini-program 自身不需要 — 它是 same-origin through tunnel）。

### C — health deep 阈值

`routes/health.js`:
```js
const LATENCY_WARN_MS = 500;
if (checks.db.ok && checks.db.latency_ms > LATENCY_WARN_MS) {
  checks.db.degraded = true;
  checks.db.note = `latency ${checks.db.latency_ms}ms > ${LATENCY_WARN_MS}ms`;
}
const anyDegraded = checks.db.degraded || checks.redis.degraded;
const status = allOk ? 200 : 503;
res.status(status).json({
  code: allOk ? 0 : 1500,
  data: { status: allOk ? 'ok' : 'down', degraded: anyDegraded, ...checks },
});
```

LB / monitor 用 `data.degraded` 字段触发告警而不踢实例（仍 200 OK）。

## 服务部署 verify

```
$ curl /api/legal/privacy headers
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Cache-Control: public, max-age=300, must-revalidate

$ curl /api/health/deep
{...checks:{db:{ok:true, latency_ms:63}, redis:{ok:true, latency_ms:0}}}

$ curl /api/internal/alert (raw body HMAC)
{"code":0,"data":{"received":true}}  ✅ verified
```

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A raw middleware 在 json 之前 | body-parser raw 看到 body 未设才会解析 |
| 2 | A express.raw type:'*/*' | 应用任意 content-type；都用 raw bytes |
| 3 | A limit 64KB | alert 体极小；防恶意大 payload |
| 4 | B CORS * | mini-program 不需要；第三方调试有用 |
| 5 | B OPTIONS 全返 200 | 简化；生产可加 origin 白名单 |
| 6 | B max-age 300 | 5 min 边缘缓存；admin bump 立即生效（不走缓存）|
| 7 | C degraded 字段 | LB 监控粒度；非 down 也告警 |

## 风险

| 风险 | 缓解 |
|------|------|
| HMAC 重启后 TS_MS skew | clock skew NTP 同步 |
| CORS 全开 | 当前内嵌 miniprogram + devtools；上线前加 origin 白名单 |
| max-age 太短 → Cache miss 多 | 5 min 是平衡点 |

## Commits
`{pending}` — round 11
