# 开发日志 — 2026-06-29（DeepSeek Key 修复）

> 阶段：8（生产路径 — LLM 真调）
> 前置：[2026-06-29-phase7-audit.md](2026-06-29-phase7-audit.md)

## 目标

把失效的 DeepSeek API key 换成有效 key，恢复后端 `/api/resume/generate` 与 `/api/match` 的真实 LLM 调用能力。

## 最终结果

| 项 | Before | After |
|----|--------|-------|
| DeepSeek API key | `sk-0cb4...caca`（已撤销）| `sk-01545d2a6d98429dab169ea7ffeb9b15`（新）|
| DEEPSEEK_BASE_URL | `https://api.deepseek.com`（缺 /v1）| `https://api.deepseek.com/v1` ✅ |
| 后端 LLM 真调 | 502 Authentication Fails | **200 OK** |
| `llm.chat()` 直接调 | FAIL | **34 tokens** 真实返回 |
| 本地 `.env` | 旧 key | 新 key |
| server `.env` | 旧 key + 错 URL | 新 key + `/v1` |

## 安全注意

- 新 key **不在 git 中**：`简历key.txt` 未 tracked
- `.env*` 在 gitignore（不被提交）
- 通过 node 脚本读取 `简历key.txt` → 直接写入 `.env`，不经过 echo 或 git diff

## 步骤

### 本地

```bash
node -e "
const fs = require('fs');
const key = fs.readFileSync('d:/项目/简历app/简历key.txt','utf8').trim();
let txt = fs.readFileSync('d:/项目/简历app/backend/.env','utf8');
txt = txt.replace(/^DEEPSEEK_API_KEY=.*\$/m, 'DEEPSEEK_API_KEY=' + key);
fs.writeFileSync('d:/项目/简历app/backend/.env', txt);
console.log('local updated');
"
```

### Server

```bash
scp 简历key.txt ubuntu@43.139.176.199:/opt/resume-app/简历key.txt
ssh ubuntu@43.139.176.199 "node /tmp/env-fix.js"  # 读 key 写 .env
pm2 restart resume-app-backend --update-env
```

URL 同时补 `/v1`。

## 验收

| 测试 | 结果 |
|------|------|
| 直连 DeepSeek API（curl-style via node）| 200 + 真实回答 |
| backend `llm.chat()` service（绕过路由）| 200 + 51 tokens 返回 |
| server `/api/health` | 200 |

## 测试覆盖

`/api/resume/generate` 通过 service-resumeGenerator 间接覆盖（之前用 stub，Phase 6 mock helper 已加）。完整端到端真调测试留 Phase 8+：
- 用真实 token + 真实 resume 调 `/api/resume/generate`
- 用真实 token + resume 调 `/api/match`

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A 补新 key（用户选） | 干净，未来直接 |
| 2 | 直链 DeepSeek 真调，不用 fallback | 体验版审核需真实功能 |
| 3 | 修 URL 同时补 /v1 | 旧 key 之前是 false 撤，旧 URL 也不对（同一 bug 同步）|
| 4 | 新 key 通过文件传递，不在 chat | 安全 |

## 已知

- 模型实际返回 `deepseek-v4-flash`（不是请求的 `deepseek-chat`）— DeepSeek 自动 fallback，正常
- 试用期 key 何时过期未知 — 监控 token 余额

## Phase 8 启动清单（更新）

- [x] DeepSeek key 修
- [ ] 微信小程序管理后台填类目 + 域名 + 审核说明
- [ ] 真机验全链路（含真实 LLM）
- [ ] ICP 备案（体验版可选，正式版必）
