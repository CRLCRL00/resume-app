# 开发日志 — 2026-07-14（Phase 8+ Round 50）

> 阶段：8+ Round 50 — dev-bypass endpoint + IDE dev login tool
> 前置：[2026-07-14-phase8-plus-round49.md](../devlog/2026-07-14-phase8-plus-round49.md)

## 起点

R49 让 IDE 不再 502 但 IDE 仍 401 Unauthorized + Error: timeout：
- `/api/resume/current` 返 401 是预期 (没 token)
- Error: timeout 来自 `login()` 调用，IDE 沙箱 `wx.login()` 永远不成功
- 即使 backend 接 `/api/auth/login` 也可能因 wechat IP 白名单 fail

## R49 实测结果

通过 server IP (绕过 serveo) 测:
| 探针 | 结果 |
|------|------|
| `/api/health` | 200 ✅ |
| `/api/health/ready` | 200 ✅ |
| `/api/legal/versions` | 200 ✅ |
| `/api/auth/login` w/ dev-bypass | **1001 wechat error: invalid ip 43.139.176.199** ❌ |

**真根因 (新发现)**: `NODE_ENV=production` 在 server 上, line 90 `if (code === 'dev-bypass' && NODE_ENV !== 'production')` 短路 → fall through to wechat code2session → server 公网 IP `43.139.176.199` **不在 wechat 白名单** `14.154.95.254` (R40 写的) → 拒。

## 改动

### 1. `backend/src/routes/auth.js` — R50 dev-only endpoint

加一条独立路由 `/api/auth/dev-bypass`，仅在 `NODE_ENV !== 'production'` 注册：

```js
if (process.env.NODE_ENV !== 'production') {
  router.post('/dev-bypass', async (req, res, next) => {
    // 同样 admin 表检查 + issueSession, 完全绕开 wechat
    ...
  });
}
```

**vs 原 /login 里 dev-bypass 短路**：
- /login 短路 — 仅当 `code === 'dev-bypass'` 时 bypass, 然后走 wechat path（prod 失效）
- 新独立 endpoint — 即时在 prod 都不挂载, 完全离线 dev 工具

部署 server side 后:
- `NODE_ENV=production` (当前): 404 not found (新 endpoint 不挂)
- `NODE_ENV=development`: 走 dev-bypass → admin 表校验 → JWT

### 2. `mini-program/app.js` — `devQuickLogin()`

```js
// R50 一行 dev-bypass login — IDE 沙箱 wx.login 永远 timeout 的 workaround
devQuickLogin(openid) {
  openid = openid || 'dev-admin';
  return new Promise((resolve) => {
    wx.request({
      url: `${apiBaseUrl}/api/auth/dev-bypass`,
      method: 'POST',
      data: { openid },
      ...
    });
  });
}
```

## UI user 走法 (完成 dev)

**user 需手动 1 步**: 在 server 上临时切 NODE_ENV=development:
```bash
ssh ubuntu@43.139.176.199
sed -i 's/NODE_ENV=production/NODE_ENV=development/' /opt/resume-app/backend/.env
pm2 restart resume-app-backend --update-env
```

> 这是 dev 行为, 不留 staging。prod 应保持 NODE_ENV=production。

然后 IDE console:
```js
getApp().devQuickLogin('dev-admin')
//  → POST /api/auth/dev-bypass → JWT 存 storage → 后续请求带 token
```

## npm test baseline

R50 加 endpoint 无效测试 (server-side only, NODE_ENV gated)。backend 422 / **0 fail** (1 skipped)。mini-program 42 / 0 fail。

| suite | tests | pass | fail | skip |
|-------|-------|------|------|------|
| backend | 422 | 421 | 0 | 1 |
| mini-program | **42** | 42 | 0 | 0 |
| **总** | **464** | **463** | **0** | **1** |

R42 起 zero fail maintained.

## 决策

| # | 决策 | 原因 |
|---|------|------|
| 1 | 用独立 endpoint /dev-bypass 而非改 /login | prod 不挂载, dev 不改 /login 安全语义 |
| 2 | 自动 commit deploy + server reload | 让 server 端立刻反映代码 |
| 3 | 不自动改 server .env NODE_ENV | 改 prod NODE_ENV 是 ops 决策; 我只代码化 endpoint |
| 4 | 不发新 token 给 mini-program to store | dev 验证已够 |

## 风险

| 风险 | 缓解 |
|------|------|
| 用户的 server 仍 `NODE_ENV=production` → dev-bypass 404 | docs 中明示 ops 切到 development |
| 真机 preview / 提交审核 → 仍需 wechat IP 白名单 | R50 不解决 — 需 mp.weixin.qq.com UI |

## Commits

| SHA | msg |
|-----|-----|
| (本 devlog + 1 file) | feat(auth): R50 — dev-bypass endpoint + mini-program quick-login helper |
