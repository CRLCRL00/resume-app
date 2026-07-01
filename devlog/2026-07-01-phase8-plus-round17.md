# 开发日志 — 2026-07-01（Phase 8+ Round 17）

> 阶段：8+ Round 17
> 前置：[2026-07-01-phase8-plus-round16.md](../devlog/2026-07-01-phase8-plus-round16.md)

## 目标

3 个 hardening 项：
A. 小程序 `request()` wrapper retry + toast 统一
B. server helmet 收紧 + CORS 白名单全局化
C. admin 列表 empty state + retry

## 最终结果

| 项 | 状态 |
|----|------|
| A request retry + toast | ✅ 76 行、向后兼容、26 caller 不动 |
| B helmet + CORS | ✅ +3 helmet keys、全局 CORS、移除 legal 局部 CORS |
| C admin empty + retry | ✅ 4 page（WXML/JS）+ 共享样式 |
| npm test 3x | ✅ 135/136 × 3 绿 |
| miniprogram test | ✅ 6 文件 × ~65ms 全过 |

## 改动详情

### A — request() wrapper

`mini-program/utils/request.js`：
- 新增 `retry` (默认 1) + `retryDelayMs` (默认 300) 选项
- 仅 GET 且网络 fail 时重试（mutation 防双提交）
- Toast 状态码兜底：400/401/403/404/429/5xx 各映射中文文案
- 网络 fail 且已重试 → '网络异常，已重试'；否则 → '网络错误，请检查网络'
- silent 跳过所有 toast
- reject payload 不变（`res.data` / `err`），26 处调用站点零修改

### B — helmet + CORS

`backend/src/middleware/cors.js`（新）：
- 读 `CORS_ALLOWED_ORIGINS` env，默认 `https://servicewechat.com,https://fa1b04c679fe9e41-...`
- OPTIONS 204 短路

`backend/src/app.js`：
- mount `corsMiddleware` 在 helmet 之后、json parser 之前
- helmet 加 3 keys：`xFrameOptions: DENY`、`crossOriginOpenerPolicy: same-origin`、`dnsPrefetchControl: { allow: false }`
- CSP 仍 `false`（纯 JSON API）

`backend/src/routes/legal.js`：
- 删除局部 CORS middleware + `router.options('*', ...)` + `ALLOWED_ORIGINS` 常量
- 3 个 GET handler + `setPublicCache` 不变

`backend/.env.example` 加 `CORS_ALLOWED_ORIGINS=...` 注释行

### C — admin list empty + retry

`mini-program/admin/styles/admin-common.wxss` 加 2 class：
- `.empty-wrap`（flex column / 居中 / 80rpx 上下间距）
- `.empty-retry`（按钮 padding 收紧）

4 个 admin list page 都加：
- wxml：`loading` / `empty+retry` 三态
- js：`loading` + `emptyText` data；提取 `loadList()` from `onShow`；`onPullDownRefresh` 复用

页面：
- `jobs/list.js` + `list.wxml`
- `logs/list.js` + `list.wxml`
- `prompts/list.js` + `list.wxml`
- `admins/admins.js` + `admins.wxml`（已有 empty 占位，换统一 pattern）

## npm test

| Run | backend pass | miniprog files |
|-----|--------------|----------------|
| 1 | 135/136 (1 skip) | 6/6 |
| 2 | 135/136 | 6/6 |
| 3 | 135/136 | 6/6 |

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A retry 仅 GET | mutation 重试易双提交 |
| 2 | A 网络 fail 才重试 | 4xx/5xx 重试无意义 |
| 3 | B CORS 默认值含 servicewechat.com | 微信小程序 source origin |
| 4 | B helmet CSP 仍 false | API 只返 JSON，不要全局 CSP |
| 5 | C `loadList()` 而非 `onShow` | 复用 + retry 按钮可点 |

## 风险

| 风险 | 缓解 |
|------|------|
| A retry 期间用户感到"卡" | 300ms 短延 + 仅 GET |
| B 默认 CORS 仅 2 origin | env 可配；当前够用 |
| C WXML 替换可能掉数据 | 对照原 list 块，未改循环体 |

## Commits

| SHA | msg |
|-----|-----|
| 7e73dda | feat(mp): request() wrapper 加 retry + toast 兜底 |
| edec06b | feat(admin): 列表 empty/retry 统一 UX |
| 95c03a9 | feat(security): CORS 白名单全局化 + helmet 加固 |
