# 真机验全链路 — Manual Test Checklist

> 配合 [backend/scripts/smoke-e2e.js](backend/scripts/smoke-e2e.js) 一同使用。
> **自动验证**：跑 smoke 验服务端
> **手动验证**：手机扫码体验各项 UI

## 一、先跑服务端 smoke

```bash
cd d:/项目/简历app/backend
NODE_TLS_REJECT_UNAUTHORIZED=0 \
BASE_URL=https://43.139.176.199 \
JWT_SECRET_OVERRIDE=resume-app-jwt-secret-2026-prod-only \
node scripts/smoke-e2e.js
```

**期望结果**：9~11/11 通过，至少 8 个核心通过（含真 LLM 调）。当下实测 9/11。

## 二、真机 UI 验证（请按顺序）

### 准备

- 用微信开发者工具打开 `d:/项目/简历app/mini-program`
- 点「**预览**」→ 扫码 → 真机打开体验版
- 真机首次启动需要微信授权（点「允许」）
- 第一次需「同意」隐私协议弹窗

### 隐私合规路径

| # | 步骤 | 期望 |
|---|------|------|
| 1 | 删除本地 storage（开发版 → 清缓存）| 重启小程序 |
| 2 | 首启看隐私弹窗 | 显示「用户协议与隐私政策」 |
| 3 | 点「不同意」 | 弹窗「需同意协议」重申，**不退出** |
| 4 | 点「同意并继续」 | 弹窗消失，进首页 |
| 5 | 首页 → 设置/关于（如有）| 跳「隐私协议 / 服务条款」 |
| 6 | 隐私协议页 | 显示完整 md 内容（300+ 字） |
| 7 | 服务条款页 | 显示完整 md 内容 |
| 8 | 返回首页 | storage 已存 `privacy_accepted=true` |
| 9 | 关小程序再开 | **不再弹**隐私弹窗 |

### 主流程

| # | 步骤 | 期望 |
|---|------|------|
| 10 | 点「立即开始」| 进 form 页 |
| 11 | 填：姓名 / 学历 / 工作 / 期望 / 技能 | 表单验证 pass |
| 12 | 点「下一步 / 保存」| 调 POST /api/resume/save |
| 13 | 进 preview 页 → 看简历 | 显示自动生成的内容（真 LLM）|
| 14 | 进 match 页 → 看岗位列表 | 显示匹配结果（真 LLM 评分）|
| 15 | 点某个岗位 → detail | 显示岗位描述 + 匹配分数 + 理由 |

### Admin 路径（如果是 admin openid）

| # | 步骤 | 期望 |
|---|------|------|
| 16 | 重启小程序 | tabBar 显示「我的」+ 管理图标 |
| 17 | 点管理 | 进 admin subpackage |
| 18 | 看 jobs 列表 | 列表加载 |
| 19 | 编辑一个 job → 保存 | 持久化 + 列表更新 |
| 20 | 看 prompts 列表 | 列表加载 |
| 21 | 看 logs 列表 | admin 操作日志记录在 |
| 22 | 重启小程序 → 登出 | 普通用户身份操作 |

### 边界

| # | 步骤 | 期望 |
|---|------|------|
| 23 | 连续点「立即开始」5 次 | 第 5 次 429（rate limit） |
| 24 | 杀掉网络再点保存 | 友好错误提示 |
| 25 | 表单留空点保存 | 表单校验提示 |
| 26 | 不存在的 resume_id 调生成 | 404 |
| 27 | 切换不同小程序账号 | 数据隔离 |

## 三、若某项失败

| 失败类型 | 检查 |
|----------|------|
| 弹窗不显示 | app.js onLaunch privacyAccept 检查 + storage |
| /api/resume/generate 502 | DeepSeek key（`sk-0154...9b15`）|
| /api/legal/* 404 | server .env (PORT=3003) + curl https://43.139.176.199/api/legal/privacy |
| 网络错 | 微信开发者工具 → 不校验合法域名 + 详情 → 本地设置 |
| admin 路径不可见 | openid 是否在 admins 表 |

## 四、报告样例

```
测试环境：https://43.139.176.199 + 微信开发者工具
测试账号：admin / 普通 openid
测试设备：xxx

| # | 项 | 通过 | 备注 |
|---|-----|------|------|
| 1 | smoke (server) | ✔ 9/11 | 1 admin + 1 wx-login |
| 1-9 | 隐私路径 | ✔ | |
| 10-15 | 主流程 | ✔ | |
| 16-22 | admin | ✔ | |
| 23-27 | 边界 | ✔ | |

结论：全链路通过 / 有问题：xxx
```

## 五、问题跟进

任何 fail：
1. 看 `backend/logs/err.log`
2. `pm2 logs resume-app-backend --lines 30 --nostream`
3. curl 测试具体接口
4. 不在 chat 贴 key / 密码
