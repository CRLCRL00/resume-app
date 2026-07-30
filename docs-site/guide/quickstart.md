# 快速开始

> TL;DR：装依赖 → 配 env → init DB → 启后端 → 跑小程序。约 5 分钟。

## 前置

- Node.js **20+**（CI 固定 20，本地推荐 22）
- MySQL **8.x**（本机或 docker）
- Redis **7.x**
- 微信开发者工具（小程序端用）
- DeepSeek API key（生产 LLM 调用）

## 1. 装依赖

```bash
git clone https://github.com/CRLCRL00/resume-app
cd resume-app
cd backend && npm install
cd ../mini-program && npm install
```

## 2. 配环境

```bash
cp backend/.env.example backend/.env
# 编辑 backend/.env，填 DB / REDIS / DEEPSEEK_API_KEY / WX_APPID / WX_SECRET / JWT_SECRET
```

完整 env 见 [环境变量参考](/reference/env-vars)。

## 3. 初始化 DB

```bash
cd backend
npm run db:init          # 重置 schema + seed admin
```

## 4. 启后端

```bash
npm start                # 生产模式
# 或
npm run dev              # watch 模式（node --watch）
```

健康检查：

```bash
curl http://localhost:3003/api/health
# → { "code": 0, "data": { "status": "ok" } }
```

## 5. 跑测试（可选）

```bash
cd backend
npm test
# ℹ tests 338
# ℹ pass 335 / fail 2 / skip 1   ← 2 个 pre-existing authLockout 失败
```

## 6. 微信小程序

1. 打开微信开发者工具
2. 「导入项目」→ 选 `mini-program/`
3. AppID 填 `wx3c0c93a02f5d2356`
4. 详情 → 本地设置 → 勾选「不校验合法域名」

## 下一步

- 看 [架构](/guide/architecture) 了解模块
- 跑 [perf-bench](/operations/perf-bench) 建立本地基线
- 读 [Smoke Test](/operations/smoke-test) 了解部署后探活
