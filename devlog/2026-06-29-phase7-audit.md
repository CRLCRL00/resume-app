# 开发日志 — 2026-06-29（Phase 7 微信审核准备）

> 阶段：7（微信小程序审核准备）
> 前置：[2026-06-29-llm-test-mock-fix.md](2026-06-29-llm-test-mock-fix.md)
> Spec：[2026-06-29-...-phase7-audit-design.md](../docs/superpowers/specs/2026-06-29-简历推荐小程序-phase7-audit-design.md)

## 目标

准备微信小程序审核材料 + 接入用户隐私合规。

## 最终结果

| 项 | 状态 |
|----|------|
| 后端 legal 接口 | ✅ `/api/legal/{privacy,terms}` GET 返 JSON |
| 后端测试 | ✅ 3 新 + 114 全量绿 5x |
| 小程序 privacy-popup | ✅ 组件 |
| 小程序 legal 页 | ✅ 2 页 (privacy + terms) |
| 小程序 app.js / app.json | ✅ 首启弹窗 + pages 注册 |
| 审核材料 | ✅ 4 文件 (审核说明 / 类目 / 测试账号 / 域名白名单) |
| 法律文档 | ✅ `docs/legal/privacy.md` + `terms.md` |
| server 部署 | ⚠️ 待人工（SSH 需要密码，本会话不可达） |

## 已落地

### 后端

| 文件 | 改动 |
|------|------|
| `backend/src/services/legal.js` | 新建：fs.readFileSync docs/legal/*.md → JSON |
| `backend/src/routes/legal.js` | 新建：`/privacy` + `/terms` 路由 |
| `backend/src/app.js` | 改：加 `app.use('/api/legal', ...)` |
| `backend/tests/route-legal.test.js` | 新建：3 测试 |

### 小程序

| 文件 | 改动 |
|------|------|
| `mini-program/components/privacy-popup/` | 新建（wxml/js/wxss/json） |
| `mini-program/pages/legal/privacy/` | 新建（wxml/js/wxss/json） |
| `mini-program/pages/legal/terms/` | 新建（wxml/js/wxss/json） |
| `mini-program/app.js` | 改：onLaunch 检测 + 延迟弹 popup（保留原有 login/checkAdmin/setToken）|
| `mini-program/app.json` | 改：注册 2 legal 页 |
| `mini-program/pages/index/index.wxml` | 改：加 `<privacy-popup id="privacy-popup">` |
| `mini-program/pages/index/index.json` | 改：声明 usingComponents |

### 文档

| 文件 | 用途 |
|------|------|
| `docs/legal/privacy.md` | 隐私协议（7 段，文末 DeepSeek 声明）|
| `docs/legal/terms.md` | 服务条款（6 段）|
| `docs/audit/审核说明.md` | 填表用，140-148 字符（限 200）|
| `docs/audit/类目说明.md` | 工具 - 效率 + 标签 + 名称 + 简介 |
| `docs/audit/测试账号.md` | 普通用户（无登录）/ admin openid / 测试 URL |
| `docs/audit/服务器域名白名单.md` | 当前 IP+自签 → 上线需备案+CA |

### 测试验收

| 跑次 | 通过 | 失败 |
|------|------|------|
| 1   | 114/114 | 0 |
| 2   | 114/114 | 0 |
| 3   | 114/114 | 0 |
| 4   | 114/114 | 0 |
| 5   | 114/114 | 0 |

稳定全绿。

### Commits

```
49e47ee feat(legal): backend /api/legal/{privacy,terms} + tests
47a17da feat(mini-program): privacy popup + legal pages + app integration
3467065 docs(audit): 审核说明 + 类目 + 测试账号 + 域名白名单
115e815 docs(spec+plan): Phase 7 WeChat audit prep (A: 全部)
```

## ⚠️ 人工待办（SSH 需密码，本会话不可达）

### 服务器端部署

```bash
ssh root@43.139.176.199
cd /opt/resume-app && git pull origin develop
pm2 restart resume-app-backend --update-env
sleep 2
curl -sk https://43.139.176.199/api/legal/privacy | head -c 100
# 期望: {"code":0,"data":{"title":"隐私协议","content":"# 隐私协议..."}
```

部署后服务端 /api/legal/* 返回 200 而非 404。

## 微信小程序管理后台配置

### 服务类目
- 选择 **工具 - 效率**（不选招聘）
- 标签：简历 / AI / 求职助手

### 服务器域名（开发设置 → 服务器域名）
```
request 合法域名:    https://43.139.176.199
uploadFile 合法域名: https://43.139.176.199
downloadFile 合法域名: https://43.139.176.199
```

⚠️ 当前 IP + 自签证书，**仅体验版 / 开发版可用**。正式上线需：
1. ICP 备案域名（如 crlcrl.com）
2. CA 证书（Let's Encrypt）
3. 备案后 30 天才能上线（小程序规则）

### 审核表单

填表参考 `docs/audit/审核说明.md`（140-148 字符内）+ `docs/audit/类目说明.md`。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A 全部（用户选） | 一次到位 |
| 2 | 服务类目 = 工具 - 效率 | 无需招聘资质，最快过审 |
| 3 | md 文档 → backend fs.read | 后端单一来源，便于更新 |
| 4 | 拒绝协议 → showModal 重申（不退出）| 微信 UX：必须接受 |
| 5 | 当前用 IP + 自签（体验版限定）| 上线前需备案（用户后续 Phase 8）|

## 已知 / 限制

- 当前 43.139.176.199 server 上未部署新代码 — **等 user SSH 部署**
- DeepSeek API key 失效 → 简历生成路径不工作（已 mock 化，不影响审核演示）
- ICP 备案 / CA 证书 / 正式上线 — Phase 8+

## Phase 8 启动清单

- [ ] Server 部署（SSH + pull + PM2 restart）
- [ ] 微信小程序管理后台填类目 / 域名 / 审核说明
- [ ] 上传体验版供审核员预览
- [ ] 微信审核员结果跟进
- [ ]（长远）ICP 备案 + CA cert + 正式版
