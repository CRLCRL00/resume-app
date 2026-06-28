# 开发日志 — 2026-06-29（Phase 5 验收）

> 阶段：5（岗位匹配）
> 前置：[2026-06-28-phase4-verify.md](2026-06-28-phase4-verify.md)

## 今日目标

- [x] 后端：jobFilter 兜底 + matchPrompt 替换占位符 + matchService 两阶段 + 缓存 + 校验
- [x] 后端：routes/match + routes/jobs + app.js 挂载
- [x] 前端：utils/constants scoreColor + 2 页面（list/detail）+ 首页「找岗位」按钮 + app.json 加 2 页
- [x] 全部测试通过 + devlog + commit + push
- [x] 服务器部署（schema 索引 + restart）

## 今日完成（量化）

| 任务 | 状态 | commit |
|------|------|--------|
| Task 1: jobFilter 兜底 | ✅ | e3fef75 |
| Task 2: matchPrompt 替换占位符 | ✅ | 77f02ae |
| Task 3: matchService 两阶段 + 缓存 | ✅ | c7ef8c5 |
| Task 4: routes/match + routes/jobs + app.js 挂载 | ✅ | b15b532 |
| Task 5: schema 索引 + 服务器部署 | ✅ | - |
| Task 6: utils/constants scoreColor + 3 测试 | ✅ | 1521665 |
| Task 7: match/list 页面 | ✅ | 5228590 |
| Task 8: match/detail 页面 | ✅ | e1a1cd3 |
| Task 9: 首页「找岗位」按钮 + app.json | ✅ | 802a2c9 |
| Task 10: 前端测试 + devlog + push | ✅ | (本 commit) |

## 关键指标

| 项 | 数值 |
|----|------|
| 后端新增文件 | 3 services + 2 routes + 1 app.js mount + 1 schema 索引 = 7 |
| 后端测试 | jobFilter 5 + matchPrompt 3 + matchService 5 + route-match 4 + route-jobs-detail 3 = 20 新 |
| 前端新增文件 | 1 utils + 2 页面 × 4 文件 = 9 |
| 前端测试 | match-format 3 新（合计 25 + 3 = 28）|
| 测试总计 | 后端 20 新 + 前端 3 新 = 23 新 |
| commits | 5（Phase 5 Batch 3）|

## 服务器 smoke test

Task 5 已跑：插入 smoke data（user + resume）→ JWT 调 `/api/match` → 200 + LLM 5 个匹配结果 → 清理 smoke data。

## 踩坑笔记

### 问题 1：plan `list.js` 依赖路径

plan 写 `require('../../utils/request' / 'loading' / 'constants')`，**没有** `parseSkills`，已确认 `format.js` 才是 `parseSkills` 所在地。Phase 4 Batch 3 教训安全生效。

### 问题 2：`wx.showModal` Promise

Phase 4 教训：`wx.showModal` 返 `Promise<{confirm, cancel}>`，不是 thenable。match/list.js 不需要 `showModal`（用 `wx.showToast` 即可），安全。

### 问题 3：plan `app.json` 顺序

plan 说"在 admin subpackage 之外"——意思是 pages 数组里的两个新 page 必须在 `subpackages` 之前。app.json 改完：
```json
"pages": [
  "pages/index/index",
  "pages/form/form",
  "pages/preview/preview",
  "pages/match/list",      // NEW
  "pages/match/detail"     // NEW
],
"subpackages": [{ "root": "admin", ... }]
```
Phase 4 已有 tabBar，不动。

### 问题 4：list.js `loadingStages` 3 段 loading

`wx.showLoading` 是非阻塞的，用 `setTimeout` 在 1s/15s 切到下一段文案。LLM 首次确实慢到 15s+。

## 决策记录

**决策 1**：SQL 下推 + JS 兜底 — 用户选
**决策 2**：学历宽松（job.degree_required rank <= user.degree rank）— 用户选
**决策 3**：score 颜色 3 档（80+ / 60+ / <60）— 设计选择
**决策 4**：24h Redis 缓存 + DB 落表（matches 表 + idx_match_batch 索引）— 设计选择
**决策 5**：限流前置（路由先 checkCache，命中不扣限流）— 用户选
**决策 6**：校验 LLM 输出（job_id 必须在 candidates 内 + score ∈ [0,100] + 截断 reason 60 字 + 排序 top 5）— 设计选择
**决策 7**：前端首页「找岗位」按钮用 `wx:if="{{hasResume}}"`（无简历不显示）— 设计选择

## Phase 5 验收（来自 spec §1）

| # | 验收项 | 状态 |
|---|--------|------|
| 1 | 用户生成简历 | ✅ 已有（Phase 2）|
| 2 | 「找岗位」按钮 | ✅ 列表 + 3 段 loading |
| 3 | 列表显示 5 个匹配岗位 | ✅ score 颜色 + reason |
| 4 | 详情页 score + reason + description | ✅ mdToHtml 渲染 |
| 5 | 24h 缓存 | ✅ Redis 24h TTL + checkCache |
| 6 | 下拉刷新 | ✅ pull-refresh |
| 7 | 测试 | ✅ 后端 20 新 + 前端 3 新 |
| 8 | 服务器部署 | ✅ smoke test 通过 |

## 启动清单（Phase 5 用户手动）

1. ⏳ **你手动测试**（Task 11）：
   - 真机登录（任意 user）→ 走「生成简历」流程
   - 首页点「找岗位」→ 看 3 段 loading → 列表显示 5 个匹配岗位
   - 点列表项 → 详情页看 score + reason + description
   - 下拉刷新 → 重跑匹配（应当返 cached=true）
   - 修改期望（重填简历）→ 重跑 → 新 batch_id
2. ✅ 服务器 smoke data 已清

## Phase 6 启动清单

- [ ] Phase 6 设计：用户收藏岗位 / 投递记录 / 推荐理由编辑
- [ ] Phase 6 plan 文档
- [ ] 派子代理跑 Phase 6 任务
- [ ] 真机验收 Phase 5 匹配流程

## 今日进度%

```
阶段累计：[████████░░] 80%
今日贡献：+10%
```
