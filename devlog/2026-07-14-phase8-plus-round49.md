# 开发日志 — 2026-07-14（Phase 8+ Round 49）

> 阶段：8+ Round 49 — backend host 集中管理 + IDE dev network 修复
> 前置：[2026-07-14-phase8-plus-round48-5.md](../devlog/2026-07-14-phase8-plus-round48-5.md)

## 起点

user IDE dev 时仍报：
```
GET https://fa1b04c679fe9e41.../api/legal/versions 502
GET https://fa1b04c679fe9e41.../api/resume/current 502
```

**这是 network 不是 code** — 我 R40 部署时的 serveo hostname `fa1b04c...` 早 11 天死掉；R44 重启后新 hostname `f2e2db03...` 但也挂了。

ide hot reload 用硬编码的 dead hostname → 502 cascade。

User 答 "Code refactor + IP hardcode (推荐)" — 改用 server 公网 IP `43.139.176.199` 直连（绕过 serveo tunnel）。

## 改动详情

### 1. `mini-program/src/config.example.js` + `src/config.js` 加 `apiBaseUrl`

```js
// R49: 后端 API base URL (no trailing slash)
// dev 用 server 公网 IP — IDE 勾「不校验合法域名」（自签 cert）
// prod 用 LE 域名 或 serveo tunnel（CI 注入）
apiBaseUrl: 'https://43.139.176.199',
```

`src/config.js`（gitignored）同样更新 — gitignored 但 dev IDE runtime 需要。

### 2. 6 处硬编码 hostname 全部抽走

| 文件 | 改前 | 改后 |
|------|------|------|
| `app.js` (login url) | `'https://fa1b04c...'` | `` `${apiBaseUrl}/api/auth/login` `` |
| `app.js` (privacy check url) | `'https://fa1b04c...'` | `` `${apiBaseUrl}/api/legal/versions` `` |
| `utils/request.js` (BASE_URL) | `'https://fa1b04c.../api'` | `` `${apiBaseUrl}/api` `` + require config |
| `utils/monitor.js` (BASE) | `'https://fa1b04c...'` | `apiBaseUrl` 直读 |
| `pages/legal/privacy.js` | `'https://fa1b04c.../api/legal/privacy'` | `` `${apiBaseUrl}/api/legal/privacy` `` |
| `pages/legal/terms.js` | `'https://fa1b04c.../api/legal/terms'` | `` `${apiBaseUrl}/api/legal/terms` `` |

**单一来源**: 改 `src/config.js` 一处，整个 mini-program 全更新。

### 3. 注释也修了

app.js 顶部注释原写 `https://fa1b04c...` — 改为 `src/config.js#apiBaseUrl` (不再 hardcode)。

## server 状态

| 项 | 状态 |
|---|------|
| backend 3003 (127.0.0.1) | ✅ 200 |
| nginx 443 (https://43.139.176.199) | ✅ 200 (自签 cert) |
| serveo tunnel | ❌ dead (R48 起 intermittent) |

**dev IDE** 用 `https://43.139.176.199` 直连 server nginx（不走 serveo），避免 tunnel 死亡连环。

## 测试 baseline

| suite | tests | pass | fail | skip |
|-------|-------|------|------|------|
| backend | 422 | 421 | 0 | 1 |
| mini-program | 42 | 42 | 0 | 0 |
| **总** | **464** | **463** | **0** | **1** |

R42 起 zero fail maintained.

## 决策

| # | 决策 | 原因 |
|---|------|------|
| 1 | 抽 apiBaseUrl 而非存多个常量 | 单一 source of truth |
| 2 | 默认 `https://43.139.176.199` (server 公网 IP) | 绕过死 tunnel；自签 cert 配 IDE「不校验合法域名」|
| 3 | 真机预览需走 serveo → 现真机仍 broken | 待 user 重置 WX 后切 domain；prod 部署后改 src/config.js 即可 |
| 4 | utils/request.js 也走 `${apiBaseUrl}/api` | 之前硬编码 `'/api'` 拼接，刚好对齐 |

## 风险

| 风险 | 缓解 |
|------|------|
| 真机预览 / 提交审核 仍 fail (serveo 死) | prod 部署后切 src/config.js 为 LE 域名 |
| 自签 cert IDE 不校验 → prod 上线仍要 LE | dev/prod 环境区分（src/config.example.js 已 doc）|
| 公网 IP 直连 = 暴露 server IP | 已有 nginx 限 (R40 + R44 Gap-11 allowlist)；公网 暴露 backend 3003 已修 (R43.5 bind 127) |

## Commits

| SHA | msg |
|-----|-----|
| (本 devlog + 6 文件) | refactor(mp): R49 — apiBaseUrl 集中 + 6 处 hostname 抽走 |

## IDE 操作

1. 拉新代码
2. IDE 详情 → 本地设置 → 勾「不校验合法域名」 (R40 之前已说明)
3. 重启 IDE / recompile
4. 应不再 502
