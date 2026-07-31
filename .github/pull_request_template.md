<!--
  R132: GitHub Flow PR 模板 (标准化 PR 描述)
  必填项用 [ ] 复选框, 描述清楚 + 关联 issue.
-->

## 📋 改了什么

<!-- 一句话讲清楚改了什么, 例如: 修 prod 5 步流路由 fail, 加 DeepSeek API key rotation -->

## 🎯 为什么改

<!-- 业务/技术背景, 例如: 用户报告 X bug, /api/Y 返回 500, 影响 Z -->

## 🔧 怎么改

<!-- 关键改动点, 例如:
  - backend/src/routes/Y.js: 加 try/catch + 错误码 1003
  - 加 migration 2026-XX-Y.sql: 加 column X
-->

## ✅ 测试

<!-- 怎么测过, 例如:
  - [x] 本地 curl /api/Y 返回 200
  - [x] backend npm test 36/36 全绿
  - [x] prod deploy verify /api/Y 200
-->

## ⚠️ 影响 / 风险

<!--
  是否 breaking change? 是否需要 migration? 是否影响 prod?
  rollout 计划: feature flag / canary / 全量
  回滚方案: git revert / pm2 reload prev
-->

## 📎 关联

<!-- Closes #123  /  Related to #456  /  See also devlog/2026-XX-Y.md -->

## 🪜 部署后验证

<!--
  部署后该跑什么命令验证, 例如:
  - ssh prod curl /api/health
  - ssh prod pm2 logs resume-app-backend --lines 20
  - GH commit status 看 prod-deploy context
-->

---

**Checklist (reviewer 用)**:
- [ ] 代码符合 CONTRIBUTING.md 流程
- [ ] 测试通过 (npm test / lint)
- [ ] commit message 符合 Conventional Commits (feat/fix/docs/style/refactor/test/chore)
- [ ] 单个 commit 一个逻辑 (atomic)
- [ ] 文档已更新 (README / runbook / API doc)
- [ ] 没有 debug print / console.log 残留
- [ ] secret / token 没 hardcode