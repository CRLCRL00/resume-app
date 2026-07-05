# 开发日志 — 2026-07-05（Phase 8+ Round 27）

> 阶段：8+ Round 27 — **上传体验版 + 提交审核**
> 前置：[2026-07-02-phase8-plus-round26.md](../devlog/2026-07-02-phase8-plus-round26.md)

## 目标

实际项目目标：把小程序代码上传到 WeChat MP 后台，生成**体验版**供 user 扫码体验，并准备**提交审核**。

26 轮 hardening 已完工，这是上线的最后一步。

## 最终结果

| 项 | 状态 |
|----|------|
| 体验版上传 | ✅ v1.0.0 上传成功（`upload done`） |
| 上传通道 | ✅ `miniprogram-ci` headless（无需 IDE 扫码登录） |
| 密钥管理 | ✅ `D:/小程序密钥.key`（RSA PRIVATE KEY, 1675B） |
| IP 白名单 | ✅ `14.154.95.254` 已加 MP 后台 |
| npm test | n/a（无后端改动） |
| 提交审核 | ⏳ user 手动操作 mp.weixin.qq.com |

## 改动详情

### 1. miniprogram-ci 安装

```bash
cd mini-program
npm install --save-dev miniprogram-ci
# → added 1082 packages in 1m
```

`mini-program/package.json` 新增：
- `miniprogram-ci` (devDependency)

### 2. 上传链路

```bash
npx miniprogram-ci upload \
  --pp ./ \
  --pkp "D:/小程序密钥.key" \
  --appid wx3c0c93a02f5d2356 \
  --uv 1.0.0 \
  --udata "智能简历助手 v1.0.0 - 简历生成+岗位匹配"
```

→ 直接走 WeChat CI API，无需 IDE 启动 / QR 扫码。

### 3. 踩过的坑

#### A. WeChat DevTools CLI 路径

发现 `cli.bat` 在：
```
C:\Program Files (x86)\Tencent\WeChatDevTools\cli.bat
```
功能齐：`open / login / islogin / upload / preview / auto / build-npm`

#### B. 服务端口自动开关

CLI 调用需 IDE HTTP server。直接 `cli islogin` 提示 `service port disabled`，需 IDE GUI 启服务端口或 `echo y | cli ...` 自动确认。

#### C. 端口自动发现

每次 CLI 起新端口（19780 / 39757 / 46627 / 25159 ...），需 `--port <port>` 显式指定。

#### D. CLI QR 登录 timeout

`cli login` 生成的 terminal ASCII QR 60s 过期，user 多次错过。GUI 弹窗 QR 也未生效。最终切到 `miniprogram-ci` headless 路径。

#### E. IP 白名单 `-10008`

第一次 `miniprogram-ci upload` 报 `invalid ip 14.154.95.254`。
原因：MP 后台「开发管理 → 开发设置 → 小程序代码上传 → IP 白名单」需手动添加本机公网 IP。
user 添加后第二次上传成功。

### 4. 提交审核（待 user 操作）

1. 浏览器 https://mp.weixin.qq.com → 扫码登录
2. 版本管理 → 开发版本 → 选 v1.0.0 → 提交审核
3. 填表：功能页面 / 类目 / 测试账号
4. 提交 → 微信 1-7 工作日审核
5. 通过 → 发布

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | 用 miniprogram-ci 而非 IDE CLI | IDE QR 登录反复超时；CI 路径稳定 |
| 2 | key 文件存 `D:/小程序密钥.key` | user 指定位置；非项目目录 |
| 3 | 把 IP `14.154.95.254` 加白名单 | 公网动态 IP，每次重连可能变 |
| 4 | 不写 upload 脚本到项目 | 临时手动命令，不污染 repo |
| 5 | dev-only `miniprogram-ci` dep | 上传是部署时用，不打包到 runtime |

## 风险

| 风险 | 缓解 |
|------|------|
| 公网 IP 变化 | 动态 IP 每次重连可能变；上传失败时需重新加 IP 白名单 |
| key 文件泄露 | 仅本地存储；泄露可在 MP 后台重置 |
| 审核被拒 | 类目选「工具→效率」最稳；隐私协议必须先在 `legal/privacy` 端点发布 |
| 体验版过期 | 体验版有效期 30 天，过期需重传 |

## 前置依赖

| 项 | 状态 |
|----|------|
| MP 后台主体认证 | 需 user 完成（个人/企业） |
| 服务类目 | 需提前在「设置 → 服务类目」选好 |
| 用户隐私协议 | `backend /api/legal/privacy` 端点已就绪 |
| 后端 API | 已部署 `serveousercontent.com` tunnel |

## 产物清单

- ✅ 体验版 v1.0.0 已上传 MP 后台
- ✅ `D:/小程序密钥.key`（代码上传密钥）
- ✅ IP 白名单 `14.154.95.254`
- ⏳ 审核提交（user 手动）
- ⏳ 发布上线（审核通过后）

## 后续（Round 28+ 可选）

- 审核 SOP 文档化
- CI 自动化上传（GitHub Actions）
- 小程序监控（错误上报 + 性能）
- 用户反馈 / 客服入口

## Commits

| SHA | msg |
|-----|-----|
| TBD | docs: round 27 devlog + miniprogram-ci dep |