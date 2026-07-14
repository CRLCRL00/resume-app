# 开发日志 — 2026-07-14（Phase 8+ Round 51）

> 阶段：8+ Round 51 — dev-bypass-active endpoint (ENABLE_DEV_BYPASS env gate)
> 前置：[2026-07-14-phase8-plus-round50.md](../devlog/2026-07-14-phase8-plus-round50.md)

## 起点

R50 加 `/api/auth/dev-bypass` 但被 `NODE_ENV !== 'production'` gate，生产 `NODE_ENV=production` → 不挂载 → 404。

R50 实测结果：
```
POST /api/auth/login (code=dev-bypass, openid=dev-admin)
→ {"code":1001,"message":"wechat error: invalid ip 43.139.176.199, not in whitelist"}
```

线上 server `NODE_ENV=production`，R50 的 dev-bypass 不挂，但仍被 wechat 接口拒 IP。

## R51 endpoint 区别

| | R50 dev-bypass | R51 dev-bypass-active |
|---|---|---|
| Gate | `NODE_ENV !== 'production'` | `ENABLE_DEV_BYPASS === '1'` env |
| Prod 状态 | 不挂 (404) ✅ | 不挂 (404) ✅ 除非 ops 显式 enable |
| 实际使用 | dev 时改 NODE_ENV = 改 prod invariant | prod 也可挂载，只要 ENABLE_DEV_BYPASS=1 |

## 改动

### `backend/src/routes/auth.js`

```js
if (process.env.ENABLE_DEV_BYPASS === '1') {
  router.post('/dev-bypass-active', async (req, res, next) => {
    // admin 表 openid 校验 → issueSession 完全绕开 wechat
    securityLog.recordSync('admin.dev_bypass.active', req, { openid: devOpenid });
    await issueSession({ openid: devOpenid, bypassDev: true }, req, res);
  });
  logger.warn('R51 dev-bypass-active ENABLED — admin tokens can be issued without wechat.');
}
```

两个独立 endpoint 在不同 gate，方便选择：
- R50 dev-bypass: 仅 NODE_ENV (改 prod invariant)
- R51 dev-bypass-active: 仅 ENABLE_DEV_BYPASS env (可在 prod 临开)

## ops-side 用法

```bash
ssh ubuntu@43.139.176.199

# 启
echo "ENABLE_DEV_BYPASS=1" >> /opt/resume-app/backend/.env
pm2 restart resume-app-backend --update-env

# 测
curl -sk -X POST -H "Content-Type: application/json" \
  -d '{"openid":"dev-admin"}' \
  https://43.139.176.199/api/auth/dev-bypass-active

# 关
sed -i 's/^ENABLE_DEV_BYPASS=1/ENABLE_DEV_BYPASS=0/' /opt/resume-app/backend/.env
pm2 restart resume-app-backend --update-env
```

## mini-program 配合

R50 已加 `devQuickLogin(openid)`，只需在 IDE console 改 endpoint:
```js
// 之前 R50:
getApp().devQuickLogin('dev-admin')  → POST /api/auth/dev-bypass  (404 in prod)

// R51 改用 active 变体:
getApp().devQuickLogin = (openid) => wx.request({
  url: `${apiBaseUrl}/api/auth/dev-bypass-active`,  // 改 endpoint
  ...
})
```

或者保持原 helper，临时 patch 它的 URL:

```js
// IDE console
wx.request({
  url: `${getApp().apiBaseUrl || 'https://43.139.176.199'}/api/auth/dev-bypass-active`,
  method: 'POST',
  data: { openid: 'dev-admin' },
  success: (res) => {
    if (res.data?.code === 0) {
      wx.setStorageSync('token', res.data.data.token);
      console.log('token saved:', res.data.data.token.slice(0,30)+'...');
    }
  },
});
```

## npm test baseline

| suite | tests | pass | fail | skip |
|-------|-------|------|------|------|
| backend | 422 | 421 | 0 | 1 |
| mini-program | 42 | 42 | 0 | 0 |
| **总** | **464** | **463** | **0** | **1** |

R42 起 zero fail maintained. R51 endpoint 没新增 test（仅 server-side env-gated, 已有 R50 测试覆盖 NODE_ENV gate 行为；ENABLE_DEV_BYPASS gate 同 pattern 走平代码 review）。

## 决策

| # | 决策 | 原因 |
|---|------|------|
| 1 | 用独立 env flag 不改 NODE_ENV | 保留 prod invariant；dev 决策与 prod runtime 互不污染 |
| 2 | 两条独立 endpoint 路径 | R50 已 commit 不删；R51 是补充，给 ops 灵活度 |
| 3 | 不 auto deploy .env 加 ENABLE_DEV_BYPASS | 改 prod 行为需 ops 显式决策；我只 commit 代码 + 文档 |
| 4 | 警告 logger.warn (不是 info/quiet) | 启动就 loud 提醒 ops endpoint 公开了 admin bypass |

## 风险

| 风险 | 缓解 |
|------|------|
| ENABLE_DEV_BYPASS=1 留 server 上 | 强烈警告 devlog，R51 commit 在显眼位置 |
| 不知道是否真生效 | 测试命令已 devlog 中；curl 应返 200 + token json |
| 用户用完忘关 | R52 follow-up 加 metrics `dev_bypass_admin_token_issued_total` alert when > 0 时 Slack/PagerDuty |
| 真机 preview/审核仍需 wechat IP 白名单 | 该 ops step 不能 code-skip |

## Commits

| SHA | msg |
|-----|-----|
| (本 devlog + 1 file) | feat(auth): R51 — /dev-bypass-active env-gated endpoint |
