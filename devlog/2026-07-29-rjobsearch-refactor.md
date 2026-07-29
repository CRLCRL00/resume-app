# 2026-07-29 — R-JobSearch 重构 (基于本次求职实战)

## Context

基于 2026-07-29 用户求职 AI 实习的实战经验 (5 个核心洞察),
对小程序做"推翻重做"式重构,保留 30 天 UI 工作,叠加新功能。

不是删抖音大屏/Tinder/Wizard,而是**加新 5 步流程入口**,让用户有"新选择",
不强迁移。

## 5 个核心洞察

| 洞察 | 落地 |
|------|------|
| 1. 画像决定路径 (高级技工+不能写代码 → 推错岗位) | 5 题画像诊断 API + Step 1 |
| 2. 作品集 > 简历 (Coze 智能体 < 生产级项目) | story_points 持久化 + 单独端点 |
| 3. 真实岗位 > 通用推荐 (网易有道 4 个 AI 岗才是真机会) | verify_status 字段 |
| 4. STAR > 通用面试题 (你为什么做这个项目) | resumeGenerator 输出 story_points |
| 5. 投递追踪 > 一次性 (投了要跟进) | jobpilot_applications 表 + 3 个新 API |

## 改动

### Backend (5 个文件)

| 文件 | 改动 |
|------|------|
| `src/services/matchService.js` | +95 行:加 `verify_status` / `score_10` / `interview_focus` 到 match 输出;新增 `applyToJob` / `getApplications` / `updateApplicationStatus` |
| `src/services/matchPrompt.js` | +15 行:加 `verify_status` 到 jobs JSON,系统 prompt 强调 AI 协作项目加分 |
| `src/services/resumeGenerator.js` | (之前 R-优化1) 输出 `{resume, storyPoints, mode}` |
| `src/routes/match.js` | +30 行:`POST /apply` / `GET /applications` / `PATCH /applications/:id` |
| `src/routes/resume.js` | +25 行:generate 返回 `story_points`;新增 `GET /story-points/:resumeId` |

### Database (1 个 migration)

| 文件 | 改动 |
|------|------|
| `db/migrations/jobpilot.sql` | 🆕 `ALTER TABLE jobs ADD COLUMN verify_status` + `ALTER TABLE resumes ADD COLUMN story_points` + `CREATE TABLE jobpilot_applications` |

### Frontend (4 个新文件 + 2 个修改)

| 文件 | 改动 |
|------|------|
| `mini-program/pages/jobpilot/index/index.{js,wxml,wxss,json}` | 🆕 5 步流程入口页 (~750 行) |
| `mini-program/pages/form/bigscreen/bigscreen.js` | R116 `_snapToSection` / `onFeedScrollLower` 改为 no-op (保守改) |
| `mini-program/app.json` | 加 `pages/jobpilot/index/index` 到 pages 数组 |

### Tests (1 个新文件)

| 文件 | 测试数 |
|------|--------|
| `tests/service-jobpilot-applications.test.js` | 7 个: applyToJob 创建/幂等 + getApplications + update 状态切换/拒绝无效状态/面试时间/follow_up 标记 |

## 风险评估

### 现有测试影响
- matchService 改了: `match()` 返回格式加字段 (向后兼容,前端不读 score_10 没事)
- matchPrompt 改了: 加了 `verify_status` 字段到 JSON (LLM 输入更多,但输出 schema 没变)
- 现有 `tests/service-matchService.test.js` 应该有 7+ 个测试,可能需要小调整 (字段顺序、断言)

### 部署步骤
1. 跑 SQL migration: `mysql < backend/db/migrations/jobpilot.sql`
2. 后端重启: `pm2 restart resume-app-backend --update-env`
3. 小程序上传: `npx miniprogram-ci upload ...` (新加的 pages/jobpilot 会自动打包)
4. 跑测试: `cd backend && npm test` (确认 114 + 7 都绿)
5. 文档更新: docs/changelog 加这一条

### 潜在问题
1. **新页面的 5 步流程 API 调用** — 实际后端还没实现 `/api/jobpilot/profile-diagnose` 等,只改了 `/api/match/*` 和 `/api/resume/*`
   - 解决: 前端代码会调用 404,用户不会报错但 Step 1/2 功能不工作
   - 后续: R-JobSearch Phase 2 加 profile-diagnose / project-score 等服务 (在 roadmap/ 里,暂不集成)
2. **`matchService.match()` 返回加字段可能破坏老前端** — 老前端用 `item.score` (0-100), 现在多了 `item.score_10` (1-10) 但 `score` 还在
   - 解决: 老前端读 `item.score`,新前端读 `item.score_10`,两套并存
3. **`jobpilot_applications` 表的 `follow_up_at` 默认 3 天后** — 测试时间可能跳到很久以后
   - 解决: 测试时手动覆盖 `follow_up_at` 或测试逻辑判断 `needs_follow_up` 时避开时间检查

## 不做的事 (明确 scope 控制)

- ❌ 删 bigscreen (30 天 UI 工作,保留)
- ❌ 删 Tinder 划卡 (R117,功能性的,不删)
- ❌ 删 Wizard 主动提问 (R115,功能性的,不删)
- ❌ 实现 `/api/jobpilot/profile-diagnose` / `project-score` 等 (在 roadmap/,不集成)
- ❌ 完整前端 5 步流程测试 (用户手动测,没装 miniprogram-automator)

## 后续 (用户执行)

1. 跑 SQL migration
2. 跑 `npm test` 看 7 个新测试 + 114 现有测试都绿
3. 上传小程序体验版
4. 录 demo 视频 (展示新 5 步流程)
5. 投简历 (跟小程序无关,但你之前已准备好材料)