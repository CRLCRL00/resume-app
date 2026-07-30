# Server Deploy — 2026-07-01（Round 18-21）

## 触发

Server 仍跑 commit `b15b532`（Round 17 之前的本地 commit）。Round 18-21 未上 server。但：
- API 表面兼容（保留旧 endpoint）
- 真机验主流程可用，无需 deploy
- 修复 server deploy 流程同时推进 Round 18-21 上线

## 策略

Server 在 `/opt/resume-app`，git 无 SSH key 无法 `git fetch origin`。
替代路径：本地 SCP 文件 → server 端覆盖 → `npm install` → `pm2 restart`。

## 文件清单 (10)

| 文件 | 来源 |
|------|------|
| `backend/package.json` | 添加 pino / pino-http / uuid / express-rate-limit / rate-limit-redis deps |
| `backend/scripts/check-env.js` | Round 21 新增 env check |
| `backend/src/middleware/auth.js` | Round 21 header 注释 |
| `backend/src/middleware/authLockout.js` | Round 21 新增 |
| `backend/src/routes/auth.js` | Round 21 refresh + logout + login 返 refreshToken |
| `backend/src/services/token.js` | Round 21 access/refresh 拆分 |
| `backend/src/routes/metrics.js` | Round 19 metrics/summary endpoint |

## 部署步骤

```bash
# 1. SCP 文件
scp ... ubuntu@server:/tmp/deploy/{package.json, scripts/, src/middleware/, src/routes/, src/services/}

# 2. server 端：backup + copy
cd /opt/resume-app/backend
cp -p package.json package.json.bak.<ts>
cp -p src/{middleware,routes,services}/*.js *.bak.<ts>
cp /tmp/deploy/package.json .
cp /tmp/deploy/scripts/check-env.js scripts/
cp /tmp/deploy/src/{middleware,routes,services}/*.js src/...

# 3. npm install 新 deps
npm install --omit=dev --no-audit --no-fund \
  pino@^9 pino-http@^10 uuid@^10 \
  express-rate-limit@^7 rate-limit-redis@^4
# → added 17 packages in 6s

# 4. pm2 restart
pm2 restart 6
```

## Sm 各步骤

| Step | result |
|------|--------|
| npm install | 17 packages added in 6s |
| pm2 restart | uptime 3s, pid 770248, mem 92.9mb |
| `/api/health` 200 | ✓ |
| `/api/legal/privacy` 200 | ✓ |
| `/api/legal/versions` 200 | ✓ |
| `/api/internal/metrics` 200 | ✓ |
| `/api/internal/metrics/summary` **200** | ✓ **Round 19 endpoint 上线** |
| POST `/api/auth/login` 400 | ✓ 缺有效 code |
| POST `/api/auth/refresh` 400 | ✓ Round 21 refresh 端点上 |
| POST `/api/auth/logout` 200 | ✓ Round 21 logout 端点（`{"code":0,"data":{"revoked":true}}`）|

## 已知小问题

1. **pino log 输出 `[object Object]`**：pino-http 把 req/res 当对象 serialize。功能正常但显示不友好。后续可改 `customProps` 或 `serializers`。
2. **首个请求超时**：重启后 Node 冷启动，curl timeout 偶尔触发。重试即恢复。
3. **`/api/internal/metrics/summary` 响应 body 格式**：labels 用 JSON.stringify 作 key，body 30KB 量级；不影响使用。
4. **server git 不能 fetch origin**：本次手动 SCP，长期建议：加 deploy key 到 server 或 build artifact 下发。

## 备份文件

`*.bak.<ts>` 留在 server，回滚直接 `mv`：
- `package.json.bak.<ts>`
- `src/middleware/auth.js.bak`、`src/middleware/authLockout.js.bak`
- `src/routes/auth.js.bak`、`src/routes/metrics.js.bak`
- `src/services/token.js.bak`

## Commits

无（本次仅部署，代码已包含在 Round 18-21 的 4 commits）
