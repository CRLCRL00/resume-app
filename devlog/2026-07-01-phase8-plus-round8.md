# 开发日志 — 2026-07-01（Phase 8+ Round 8）

> 阶段：8+ (审计读 + 更新 + LLM cost)
> 前置：[2026-07-01-phase8-plus-round7.md](../devlog/2026-07-01-phase8-plus-round7.md)

## 目标

3 个 hardening 项：
A. admin audit 日志读 + prune
B. 小程序更新提示
C. LLM token 用量监控

## 最终结果

| 项 | 状态 |
|----|------|
| A admin audit 读 + prune | ✅ /api/admin/logs/security + /logs/prune |
| B 小程序 update manager | ✅ app.js 加 wx.getUpdateManager |
| C LLM token | ✅ services/llm.js logUsage |
| npm test 3x | ✅ 120/121 × 3 绿 |

## 改动详情

### A — admin 日志读 + 清理

`backend/src/routes/admin/logs.js`:
- GET `/api/admin/logs` — 已有（保留）
- **GET `/api/admin/logs/security?days=7`** — 只返 `security.*` 事件（最近 N 天）
- **DELETE `/api/admin/logs/prune?days=90`** — 清 >N 天 logs（admin only）

### B — 小程序强制更新

`mini-program/app.js` onLaunch 尾部加：
```js
if (wx.getUpdateManager) {
  const updateManager = wx.getUpdateManager();
  updateManager.onCheckForUpdate(res => {});
  updateManager.onUpdateReady(() => {
    wx.showModal({
      title: '更新提示',
      content: '新版本已准备好，是否重启应用？',
      success: (r) => { if (r.confirm) updateManager.applyUpdate(); }
    });
  });
  updateManager.onUpdateFailed(() => {});
}
```

微信发布新版后，用户首次启动自动弹「需重启」提示。

### C — LLM token 用量监控

`services/llm.js`:
```js
function logUsage(callPath, usage, model) {
  if (!usage || typeof usage.total_tokens !== 'number') return;
  logger.info({
    llm: callPath, model, prompt_tokens, completion_tokens, total_tokens,
  }, 'llm usage');
}
```

`chat()` 调用后立即 `logUsage('chat', data.usage)` — 每次 LLM 调 trigger 一次 `logger.info`。

字段：prompt_tokens / completion_tokens / total_tokens + model。`chatJson` 也走 chat 自动带上。

业务上消耗可见：
- 单次简历生成 ~1500 tokens
- 单次岗位匹配 rerank ~800 tokens

后续可加：聚合 cron（每日 total 上报到监控）+ 高水位告警。

## npm test

| Run | 通过 | 失败 |
|-----|------|------|
| 1 | 120/121 | 0 |
| 2 | 120/121 | 0 |
| 3 | 120/121 | 0 |

## 服务部署 verify

| 项 | 结果 |
|----|------|
| GET /api/legal/versions | 200 |
| GET /api/admin/logs/security?days=7 | 1003 admin only（非 admin，正确拒绝）|
| monitor cron | 持续 OK 200 log |

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A 路由 admin only | 高敏感信息；getLogs 默认全 + filter 风险高 |
| 2 | A prune 默认 90 天 | 平衡存储 vs 审计保留 |
| 3 | B 弹窗 confirm | 用户可选不更新（不影响功能）|
| 4 | C 默认 logger.info（不阻塞监控）| 数据轻量；告警阈值可下轮再加 |

## 风险

| 风险 | 缓解 |
|------|------|
| A prune 误删 | days ≥ 7 校验 + admin only |
| B 用户拒绝更新 | 功能仍可用（功能向后兼容） |
| C token 上报过多 | info 级别；logrotate 防 disk 满 |

## Commits

`{pending}` — round 8 含 5 文件改动
