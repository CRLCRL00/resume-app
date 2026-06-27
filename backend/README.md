# 后端

简历推荐小程序后端，Node 20 + Express 4。

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

## 部署

见 `docs/operations/deploy.md`。