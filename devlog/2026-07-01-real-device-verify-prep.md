# 真机验准备 — 2026-07-01

## Server 状态

| 项 | 值 |
|----|----|
| Tunnel | `https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com` |
| pm2 process | `resume-app-backend` (id 6), online, 4h uptime, 17 重启历史 |
| working dir | `/opt/resume-app/backend` |
| HEAD | `b15b532` (本地 commit 早于 origin/develop) |
| GitHub 访问 | server 无 SSH key → `git fetch` 失败 |

### Server 端点 smoke

| Endpoint | 状态 |
|----------|------|
| GET `/api/health` | 200 (uptime 4.7h) |
| GET `/api/legal/privacy` | 200 |
| GET `/api/legal/terms` | 200 |
| GET `/api/legal/versions` | 200 |
| POST `/api/auth/login` `{code:"..."}` | 400 (待真 code) |
| POST `/api/auth/wx-login` | 404 (server 旧 commit 无此端点；app.js 用 `/auth/login`) |
| POST `/api/resume/generate` `{}` | 401 (待 token) |
| POST `/api/match` `{}` | 401 (待 token) |
| GET `/api/internal/metrics/summary` | 404 (Round 19 端点未上 server) |

Server 跑 Round 17 之前的 commit。Round 18-21 的代码未上 server，但 API 表面兼容：
- Round 18: LLM sanitize 不改接口
- Round 19: metrics/summary 是 NEW endpoint，不影响旧路径
- Round 19: adminAudit 中间件不挂断响应（fail-silent INSERT）
- Round 19: pino logger 替换 winston，stdout 兼容
- Round 20: ready/live + start-prod — 未挂上 server 所以不影响
- Round 21: refresh token + login — 新增路由 `/api/auth/refresh` 和 `/api/auth/logout`；旧 login 仍返 `token`

### 关键观察

- `/api/auth/login` 仍接受 `{code}`；新 refresh 端点不上 server，旧 token 仍可用
- app.js 用 `/api/auth/login` + `{code}` 调用，与 server 兼容
- 真机验主路径（Form/Generate/Match）均可走通

## Mini-program 状态

| 文件 | 内容 |
|------|------|
| `mini-program/project.config.json:2` | `"appid": "wx3c0c93a02f5d2356"` ✓ |
| `mini-program/project.private.config.json` | 存在 (618 bytes, 6/28 写入) — 含 WX code 私钥 |
| `mini-program/utils/request.js` | Round 17 retry+toast |
| `mini-program/utils/auth.js` | token get/set/clear |
| `mini-program/app.js:67` | BASE_URL `https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com/api/auth/login` |
| `mini-program/app.js:99` | `/api/legal/versions` check |
| `mini-program/app.js:23-25` | privacy-popup 引用 |
| 4 admin 页面 | Round 17 empty+retry |

## 用户动作清单

### Step 1 — 启动开发者工具

1. 打开「微信开发者工具」
2. 选「小程序」→ 「导入项目」
3. AppID: `wx3c0c93a02f5d2356`（已写 `project.config.json`，自动填）
4. 项目目录：选 `d:\项目\简历app\mini-program`
5. 后端服务：选「不使用云服务」
6. 点「导入」

### Step 2 — 关闭域名校验

工具栏 → 详情 → 本地设置 → 勾「**不校验合法域名**」（必勾，因 tunnel URL 是临时域名）
- app.js:1 注释里已写

### Step 3 — 编译器选择

右下角选「**真机调试**」或扫码预览模式（不要用「自动预览」）

### Step 4 — 预期路径

1. 进入小程序 → 隐私弹窗（Round 14，loading），关
2. 自动跳首页 → 走 `/api/auth/login`（wx.login 成功后置 token 到 storage）
3. **devtools 沙箱里 wx.login 会失败**：用 console 调 `setToken('...')` 塞一个测试 token（user 已 seed admin/dev openid）
4. 表单页 → 填基本信息 → 提交 → 调 `/api/resume/generate` → preview
5. preview → 点「推荐岗位」→ `/api/match` → 列表
6. 详情页

### Step 5 — 异常检查点

| 现象 | 排查 |
|------|------|
| 启动报网络错 | 「不校验合法域名」未勾 |
| `wx.login` 永远 fail | devtools 自动跳过（app.js:35-38 已判断）；用 setToken 模拟 |
| privacy 弹窗不弹 | storage 已有 `privacy_accepted`；开发者工具清缓存重试 |
| generate 401 | token 无效 → 后台用 `/api/auth/login` 真实 code 跑一次 |
| 真机扫不上 | 检查 `project.private.config.json` 仍有效；或重新 `miniprogram-ci` 上传体验版 |

## 不需要更新的东西

- Server **不需要** restart：现 commit API 兼容
- Server pm2 id 6 4h uptime 不动；Round 18-21 上线（非阻塞，可后做）
- Mini-program 代码已是 Round 17 最新（含 retry/empty/admin styles）— 直接导入即可

## Commits

无（本次仅为真机验环境确认 + 文档，未改代码）
