# 后端

简历推荐小程序后端，Node 22+ / Express 4（`npm test` 需 Node 22+；`start`/`dev` 在 Node 20+ 也能跑）。

## 本地跑

```bash
cp .env.example .env
# 改 .env 里的 DB/REDIS 密码
npm install
npm run db:init
npm run dev
```

## 跑测试

```bash
npm test
```

## 测试要求

`npm test` 使用 `--test-force-exit`（Node 22+ 特性）。生产脚本 `start` / `dev` 不需要 Node 22+。

Node 22+ 安装方法：https://nodejs.org/zh-cn/download 或 `nvm install 22`。

## 部署

见 `docs/operations/deploy.md`。