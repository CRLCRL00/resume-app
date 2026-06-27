# 开发日志 — 2026-06-27（Phase 1 收尾：手动活 + 443 路由坑）

> 阶段：1（收尾）+ 修 443 路由 bug
> 前置：[2026-06-27-phase1-verify.md](2026-06-27-phase1-verify.md)

## 今日目标

- [x] 用户撤销 2 个泄露 GitHub PAT
- [x] 填 WeChat AppSecret 到服务器 `.env`
- [x] PM2 开机自启
- [x] 修 HTTPS 路由 bug（443 被 mbti-admin 抢）

## 完成

| 任务 | 状态 | commit |
|------|------|--------|
| 撤 PAT（旧+新） | ✅（用户手动） | — |
| 填 WX_SECRET + 重启 PM2 | ✅ | 见踩坑 |
| PM2 startup + save | ✅ | — |
| 修 443 路由 | ✅ | 见踩坑 |
| 同步本地 nginx conf | ✅ | 本次提交 |

## 踩坑笔记（追加）

### 问题 5：Phase 1.5 验收被骗（critical）

#### 现象
填 WX_SECRET 后，HTTPS `/api/auth/login` 返 phone/password 校验错。以为是 WX 配错了。

#### 真相
- 服务器 `pm2 list` 里有 `aigc-api (3001)` 一直跑（用户别的项目）
- `aigc-api` 后端也有 `/api/health`，返 `{"code":0,"message":"ok",...}`
- 我们 backend `/api/health` 返 `{"code":0,"data":{"status":"ok","uptime":...}}`（没 `message` 字段）
- **Phase 1.5 时 curl 看到 code:0 就以为通了，没 diff 字段** → 实际打的是 aigc-api
- HTTPS IP 请求被某个老 server 的 default 兜底，proxy 到 3001

#### 修复
1. 改 resume-app.conf 加 `default_server`（listen 80 + listen 443）
2. 移 conf.d → sites-enabled（这台 nginx.conf 不 include conf.d）
3. 删 `http2 on;`（nginx 1.24 不支持独立指令）
4. 端口 3002 → 3003（3002 被 mbti-admin web 占）
5. `pm2 restart --update-env` 拉新 env（reload 不重读 env）

#### 验证
```
$ curl -sk https://43.139.176.199/api/health
{"code":0,"data":{"status":"ok","timestamp":"...","uptime":280.79}}

$ curl -sk -X POST https://43.139.176.199/api/auth/login \
    -H 'Content-Type: application/json' -d '{"code":"test_invalid"}'
{"code":1001,"message":"wechat error: invalid code, rid:..."}
```
- health 返我们的 `data.status:ok` 格式 ✓
- login 真调微信，code 错被拒 ✓

#### 教训
- **验证接口必须 diff 字段**（不只是 HTTP code）
- **`/api/health` 不可信** — 多后端共存的服务器，任何人都有 /api/health
- **HTTPS 测试要追到具体后端**：curl 直接打后端端口对比
- **nginx.conf include 路径要先看** — 别假设 `conf.d/` 自动加载
- **nginx 版本特性要看**：1.24 没 `http2 on;`

---

### 问题 6：PM2 reload 不重读 .env

#### 现象
改完 `/opt/resume-app/backend/.env`，`pm2 reload resume-app-backend`，新进程起来后 env 还是老的。

#### 真相
- `pm2 reload` = 0s 重载（用 systemd 风格），但 env 在进程启动时快照
- 必须 `pm2 restart xxx --update-env`

#### 教训
- 改 .env 永远 `--update-env`
- reload 只用来无停机部署代码

---

### 问题 7：WX_APPID 跟计划里不一样

#### 现象
部署文档里 `WX_APPID=wx317478190d056fb0`，但用户实际账号是 `wxf9c88ec9dd38cc64`。

#### 真相
Phase 0 plan 阶段用户给了旧 ID，Phase 1 实际部署时用户新注册了号。

#### 修复
服务器 `.env` 改成 `wxf9c88ec9dd38cc64`，本地 `.env` 也要同步（待办）。

#### 教训
- AppID 这种"配置"放进 plan 文档前要二次确认
- 实际 ID 写进 `.env`，plan 只记占位

---

## PM2 开机自启验证

```bash
$ sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ubuntu --hp /home/ubuntu
[PM2] Init System found: systemd
[PM2] Command successfully executed.

$ pm2 save
[PM2] Saving current process list...
[PM2] Successfully saved in /home/ubuntu/.pm2/dump.pm2
```

- systemd unit: `/etc/systemd/system/pm2-ubuntu.service`（enabled）
- dump: `/home/ubuntu/.pm2/dump.pm2`
- 服务器重启后 4 个进程自动拉起（resume-app-backend + aigc-*）

## 服务器当前状态

```
┌────┬───────────────────────┬──────┬────────┬──────────┬───────┐
│ id │ name                  │ mode │ pid    │ status   │ uptime│
├────┼───────────────────────┼──────┼────────┼──────────┼───────┤
│ 0  │ aigc-api              │ fork │ 2184498│ online   │ 4D    │
│ 1  │ aigc-web              │ fork │ 2184499│ online   │ 4D    │
│ 2  │ aigc-worker           │ fork │ 2184505│ online   │ 4D    │
│ 4  │ resume-app-backend    │ fork │ 3589456│ online   │ 7m    │
└────┴───────────────────────┴──────┴────────┴──────────┴───────┘
```

后端：`http://127.0.0.1:3003`（PM2）
前端入口：`https://43.139.176.199/api/*`（Nginx → 3003）

## 决策记录

**决策 5：本地 .env 的 WX_APPID 暂不同步**

**原因：** 本地没真微信测试（前端还没起），改了反而跑测试要 mock 多一个 ID。
等 Phase 2 前端起的时候再统一改。

**替代方案：**
- 立即同步 → 浪费测试 mock 工作量
- 只服务器改 → 前端调试时要分别记两个 ID

---

## Phase 1 最终状态

| 指标 | 目标 | 实际 |
|------|------|------|
| 后端代码行数 | ≥ 500 | 1055 |
| 测试 case | ≥ 6 | 32 |
| 测试通过率 | 100% | 100% |
| Lint | 0 error | 0 |
| 部署 | HTTPS 跑通 | ✅（修 443 后） |
| LLM 真调 | /api/test/llm | ✅ |
| 微信真调 | /api/auth/login | ✅ |
| PM2 自启 | systemd | ✅ |

**8/8 全过。Phase 1 闭环。**

## Phase 2 启动条件

- [x] 32 测试 pass
- [x] 服务器 HTTPS 真打到我们 backend
- [x] 微信 code2session 真调通
- [x] PM2 自启
- [x] 用户注册微信开发者工具（用 AppID `wxf9c88ec9dd38cc64`）

**可以进 Phase 2（小程序骨架）。**

## 明日计划

- [ ] 创 Phase 2 plan 文档
- [ ] 派子代理跑 Phase 2 任务
- [ ] 同步本地 `.env` 的 WX_APPID（前端起时）

## 已撤销（用户完成）

1. ✅ GitHub PAT `11CAQ3JHA0I4...`（旧）
2. ✅ GitHub PAT `11CAQ3JHA0mP...`（新）

## 已修复（本次提交）

1. resume-app.conf：删 `http2 on;`、加 `default_server`、端口 3002→3003、移到 sites-enabled 路径