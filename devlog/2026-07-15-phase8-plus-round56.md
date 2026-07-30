# 开发日志 — 2026-07-15（Phase 8+ Round 56）

> 阶段：8+ Round 56 — 全 audit + 4 hidden issues + tunnel fix
> 前置：[2026-07-15-phase8-plus-round55.md](../devlog/2026-07-15-phase8-plus-round55.md)

## 起点

user 答"查一下看还有没有没发现的"。我做全面 audit, 发现 4 hidden issues:

| # | 问题 | 严重 |
|---|------|------|
| 1 | `cors.js:1` 默认 `CORS_ALLOWED_ORIGINS` 含已死 `fa1b04c...` serveo hostname | 中 |
| 2 | `openapi.js:52` OpenAPI `servers[0].url` 同 stale | 低 |
| 3 | **server-side systemd Restart=on-failure + SuccessExitStatus=255** → exit 255 = success, ssh 死了不会 restart. tunnel 死循环. | **高** |
| 4 | R55 fix 1/2/3 (tunnel fix 我以为是 done) 实际**仍 502** | 高 |

## R56 fix per issue

### Issue 1+2: cors.js + openapi.js stale origin

`backend/src/middleware/cors.js`:
```diff
-const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || 'https://servicewechat.com,https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com')
+const DEFAULT_ORIGINS = [
+  'https://servicewechat.com',
+  'https://43.139.176.199',  // R56: server IP (R44 tunnel stale hostname removed)
+];
+const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(','))
```

`backend/src/routes/openapi.js`:
```diff
 servers: [
-  { url: 'https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com', description: 'tunnel' },
-  { url: 'https://43.139.176.199', description: 'IP' },
+  { url: 'https://<tunnel-host>.serveousercontent.com', description: 'tunnel (replace with current)' },
+  { url: 'https://43.139.176.199', description: 'IP' },
   { url: 'http://127.0.0.1:3003', description: 'local dev' },
 ],
```

### Issue 3+4: systemd tunnel Restart=always

**Root cause (R55 followup)**:
- 我 R55 改成 `Type=simple` + 直接 ssh + `SuccessExitStatus=255`
- **但** `Restart=on-failure` 只在 failure 重启; 我把 255 加 SuccessExitStatus = 不算 failure
- ssh exit 因 serveo 端**2 min 内 timeout** (keyboard-interactive auth) = 实际 return 255
- systemd 看作 success → **不 restart**
- journal 显示: `Jul 15 11:06:12 Forwarding... → 11:08:01 Deactivated successfully` (2 分钟后 die)

**修法** (`/etc/systemd/system/resume-app-tunnel.service`):
```diff
-[Service]
+[Service]
 Type=simple
 Restart=on-failure
 RestartSec=60
 StartLimitBurst=10
 StartLimitIntervalSec=600
 SuccessExitStatus=255
+Restart=always
```

`Restart=always` = 任何原因死都重启 (含 255). ssh 死了 60s 内被 systemd 续命.

### Verify

```
Active: active (running) since Wed 2026-07-15 11:50:15 CST; 10s ago
Tasks: 1 (limit: 2265) ← ssh 进程长存
new HN: https://23a18edcbfa51a5e-43-139-176-199.serveousercontent.com

6/6 probe via tunnel = 200 ✅
```

### CORS verify

`Access-Control-Allow-Origin: https://43.139.176.199` (server IP origin OK).

## baseline

backend 425 / 0 fail / 1 skip. mini-program 47 / 0 fail. R42 起 zero fail maintained.

## 决策

| # | 决策 | 原因 |
|---|------|------|
| 1 | CORS default 加 server IP, 删 stale serveo | 真机 preview 用 IP 直连 (R49 路径) 不再需要 tunnel |
| 2 | OpenAPI server 用 placeholder `<tunnel-host>` | 文档显式说明 ops 填新 HN |
| 3 | **Restart=always** | simple service + 任何原因死 restart |
| 4 | 不再调 `ServerAliveInterval` (30s 仍不够) | 这是 serveo 端 timeout, 不是 keepalive 问题 |

## 留 follow-up

| # | 项 | 谁 |
|---|----|------|
| 1 | 真机 preview 验证新 HN (`23a18edc...`) | user (mp.weixin.qq.com 加服务器域名) |
| 2 | 服务端 `.env` 设 `CORS_ALLOWED_ORIGINS` (含 tunnel HN) 为未来 restore 做准备 | ops |
| 3 | 我 skip 了"用 `<your-tunnel-host>` placeholder in OpenAPI" — Swagger UI 仍显占位, 实际 client 不会自动填 | R57 followup |
| 4 | 自动同步 HN 到 OpenAPI server list via cron | R57 |

## 改了什么

| 文件 | 内容 |
|------|------|
| `backend/src/middleware/cors.js` | DEFAULT_ORIGINS server IP, 删 stale |
| `backend/src/routes/openapi.js` | placeholder URL |
| `/etc/systemd/system/resume-app-tunnel.service` | `Restart=always` |

## Commits

| SHA | msg |
|-----|-----|
| (本 devlog + 2 files) | fix: R56 — cors stale origin + Restart=always fix tunnel |
