# 开发日志 — 2026-07-01（Phase 8+ Round 12）

> 阶段：8+ Round 12
> 前置：[2026-07-01-phase8-plus-round11.md](../devlog/2026-07-01-phase8-plus-round11.md)

## 目标

3 个 hardening 项：
A. 优雅关闭 + CORS 白名单
B. 负载 smoke 脚本
C. SECURITY.md + bug policy

## 最终结果

| 项 | 状态 |
|----|------|
| A 优雅关闭 + CORS | ✅ SIGTERM/INT + CORS_ALLOWED_ORIGINS env |
| B 负载 smoke | ✅ 65/65 健康查 200 |
| C SECURITY.md | ✅ 报告渠道 + SLA + hardening 列表 |
| npm test 3x | ✅ 120/121 × 3 绿 |

## 改动详情

### A — 优雅关闭

`src/index.js`：
- `isShuttingDown` flag + middleware 拒新请求 → 503 Connection: close
- `server.close()` 等 in-flight 完成
- `server.closeIdleConnections?.()` 25s 后强制 close keep-alive
- 30s 硬超时 → `process.exit(1)`
- 关闭 `pool.end()` + `redis.quit()`
- `uncaughtException` + `unhandledRejection` 触发 graceful shutdown
- `server.keepAliveTimeout = 65000` + `headersTimeout = 66000`（nginx 标准值）

### A — CORS 白名单

`routes/legal.js`：
```js
const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
//  '*' → 全部允许（dev）；其他→精确 origin 白名单
//  Origin header 缺 → 不返 CORS 头，浏览器 block
```

生产设置 `CORS_ALLOWED_ORIGINS=https://mp.weixin.qq.com,https://你的域名` 即可。

### B — 负载 smoke 脚本

`scripts/smoke-load.sh`：
- 20 并发 × 5s，命中 `/api/health`
- 统计平均 / 最大延迟
- log: `/var/log/resume-app-load.log`（dev 也安全）
- 调：

```bash
BASE_URL=https://... node scripts/smoke-load.sh
```

dev 跑 65/65 OK (1137ms avg via tunnel)。

### C — SECURITY.md

```
- 漏洞报告：email + 微信群 + 加密
- SLA：critical 24h, high 72h, medium 7d, low 30d
- 报告内容建议模板
- Safe Harbor
- 当前安全姿态清单（12 项 hardening 累计）
- npm audit 周全
```

## 服务部署 verify

```
$ curl /api/legal/privacy headers
Access-Control-Allow-Origin: *

$ curl /api/health (pm2 后)
{status: ok, uptime: 4.05}
```

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A keepAlive 65s/headers 66s | nginx 默认匹配；优雅 close |
| 2 | A 25s 软 + 30s 硬超时 | 长 LLM 调用留余；硬超时保底 |
| 3 | B 默认 CORS='*' | dev 兼容；生产改 env 白名单 |
| 4 | C bug SLA 阶梯化 | critical/high/medium/low |

## 风险

| 风险 | 缓解 |
|------|------|
| 优雅关闭 30s 后强制 exit | 几乎所有 LLM/DB 在 5s 内 |
| CORS 白名单设错误杀 | 提供 '*' fallback 防 dev 卡住 |
| Load 测试噪音大 | 仅是 sanity check；prod 用 k6/wrk |

## Commits
`{pending}`
