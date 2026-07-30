# 开发日志 — 2026-07-01（Phase 8+ Round 10）

> 阶段：8+ Round 10 (HMAC + 密钥轮换 + Helmet 强化)
> 前置：[2026-07-01-phase8-plus-round9.md](../devlog/2026-07-01-phase8-plus-round9.md)

## 目标

3 个 hardening 项：
A. monitor HMAC 签 + 密钥轮换 runbook
B. OpenAPI JSDoc 自动（跳过，hand-rolled 更适合当前规模）
C. Helmet 路由细化 + HSTS preload

## 最终结果

| 项 | 状态 |
|----|------|
| A monitor HMAC + 轮换 doc | ✅ scripts/monitor.sh X-Alert-Signature + 8-key 轮换 plan |
| B OpenAPI JSDoc | ⏸️ 跳过（手维护 26 paths 就够）|
| C Helmet 强化 | ✅ HSTS preload + 10+ 头 + COEP carve |
| npm test 3x | ✅ 120/121 × 3 绿 |

## 改动详情

### A — HMAC 签名 + 轮换

**scripts/monitor.sh**:
```bash
TS_MS=$(date +%s%3N)
SIG=$(printf "%s" "$PAYLOAD$TS_MS" | openssl dgst -sha256 -hmac "$ALERT_TOKEN" | sed 's/^.* //')
curl ... -H "X-Alert-Token: $ALERT_TOKEN" \
        -H "X-Alert-Timestamp: $TS_MS" \
        -H "X-Alert-Signature: sha256=$SIG"
```

**routes/alerts.js** — 验证：
- X-Alert-Token 鉴权
- X-Alert-Timestamp 在 ±5 min 窗口
- X-Alert-Signature HMAC-SHA256(canonical_body + ts, secret)
- 用 `crypto.timingSafeEqual` 防 side-channel
- 失败 → 401

⚠️ **Caveat**：服务端用 `JSON.stringify(req.body)` 不是 raw body。规范化 JSON 序列化（key 顺序 / 空白）可能 hash 不一致。生产应保留 raw body（express.raw + verify callback）。当前本地 smoke 验过，跨环境未验。

**docs/audit/secret-rotation-runbook.md** — 8 类密钥轮换流程：
1. ALERT_TOKEN (90d)
2. JWT_SECRET (180d)
3. DEEPSEEK_API_KEY (365d 或泄露立即)
4. WX_SECRET (365d)
5. DB_PASSWORD / REDIS_PASSWORD (365d)
6. 操作流程（备份 + .env + pm2 + verify + git log）
7. 自动化候选
8. 紧急撤销

### C — Helmet 强化

`app.js`:
```js
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  strictTransportSecurity: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,     // 新加 — 提交 hstspreload.org 候选
  },
  referrerPolicy: { policy: 'no-referrer' },
  permittedCrossDomainPolicies: false,
  hidePoweredBy: true,
  noSniff: true,
  xssFilter: true,
}));

app.use('/api/docs', (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  next();
});
```

Swagger UI 用 CDN 加载外部脚本，需 COEP=unsafe-none；其他路由保留默认 COEP=same-origin。

## 服务部署 verify

```
$ curl /api/health (helmet headers)
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: cross-origin
Referrer-Policy: no-referrer
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
```

7+ 头注入；HSTS preload 启用（生产可去 hstspreload.org 提申请）。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A server 用 `JSON.stringify(req.body)` | 简化；生产用 raw parser 替代 |
| 2 | A 最大 ±5 min 时钟漂移 | 跨主机合理容差 |
| 3 | A secret 用 `timingSafeEqual` | 防时序攻击 |
| 4 | B OpenAPI JSDoc skip | 当前 26 paths 还能手维护；规模化后重做 |
| 5 | C HSTS preload=true | 仅声明；正式上线去 hstspreload.org 申请 |
| 6 | C /api/docs 例外 COEP | Swagger UI 用 CDN |

## 风险

| 风险 | 缓解 |
|------|------|
| HMAC client/server JSON 序列化差异 | 当前本地通过；生产跑前 raw parser refactor |
| HSTS preload 真提交 | 备案 + 域名后才有意义；列 pragma |
| secret 轮换 doc 漂移 | 实际轮换时即检 doc；触发 doc review |

## Commits
`{pending}`
