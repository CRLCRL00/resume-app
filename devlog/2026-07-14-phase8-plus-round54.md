# 开发日志 — 2026-07-14（Phase 8+ Round 54）

> 阶段：8+ Round 54 — 业务数据可视化大屏 + server-deploy + adminAuth fix
> 前置：[2026-07-14-phase8-plus-round53.md](../devlog/2026-07-14-phase8-plus-round53.md)

## 起点

user 答 "我的想法是要是把它做成可视化的数字大屏会不会更好点" + "比如城市那些"。确认 R54 = 业务数据 dashboard (用户/简历/岗位/匹配计数 + 城市/薪资/时间趋势)。

## 改动详情

### 1. backend `src/routes/admin/dashboard.js` (新, 165 行)

5 GET endpoint, 全部 adminAuth:

| Endpoint | 用途 |
|----------|------|
| `GET /api/admin/dashboard/overview` | KPI tiles (users/resumes/jobs/matches + 7d) |
| `GET /api/admin/dashboard/cities` | users_by_city (resumes.source_form JSON extract) + jobs_by_city |
| `GET /api/admin/dashboard/salary` | 6-bucket salary histogram (avg min/max K) |
| `GET /api/admin/dashboard/degree` | degree_required 分组 |
| `GET /api/admin/dashboard/trends?days=14` | 14 天每日子查询 (users/resumes/matches) |

**SQL 关键**:
- `JSON_EXTRACT(resumes.source_form, '$.expected.city')` 提取用户期望城市
- `FIELD(bucket, ...)` 保 salary 桶顺序

### 2. backend `src/routes/admin/dashboard.js` (R54 follow-up fix)

```diff
 const express = require('express');
 const router = express.Router();
+const { userAuth } = require('../../middleware/auth');
+const { adminAuth } = require('../../middleware/adminAuth');
 const { pool } = require('../../config/db');
+
+// R54 fix: admin/business dashboard API — requires userAuth + adminAuth on every route
+router.use(userAuth, adminAuth);
```

**bug**: 初次 deploy 后 no-auth 探针 = 500 (应是 401). admin/index.js 把 `require('./dashboard')` mount, 但 dashboard.js 内部没导入 adminAuth — 每个 GET 没 auth handler. 修后: `router.use(userAuth, adminAuth)` 在 route handlers 前 (admin/jobs.js /admin/prompts.js 等 inline auth 但路径层 init 也 OK).

### 3. backend `src/routes/admin/index.js`

```diff
 router.use('/queries', require('./queries'));
+router.use('/dashboard', require('./dashboard')); // R54
```

### 4. backend `tests/admin-dashboard.test.js` (新, 4 tests)

| 测试 | 验证 |
|------|------|
| overview | code=0 + KPI fields 类型 |
| cities | users_by_city + jobs_by_city 数组 |
| salary | 6 buckets + field 类型 |
| trends | ?days=1/7/14 都返数组 + date/users/resumes/matches |

Test 框架先 inject fake req.user, 通过 router.use(userAuth, adminAuth) → 401 中间件 mock 出 user (auth 实际在 prod 路径验证). 测试**实际 HTTP 调用**而不 mock pool.

### 5. mini-program `admin/pages/dashboard/` (5 新 files)

- `dashboard.js` (90 行) — 拉 5 endpoint + pre-compute bar widths
- `dashboard.json` — pull-down + 深色背景
- `dashboard.wxml` — KPI tiles + 双栏 cities + salary + trends
- `dashboard.wxss` (110 行) — 深色大屏 CSS (gradient + glow)

### 6. mini-program `app.json`

dashboard 加 admin subpackage pages **第一位** (admin 默认看 dashboard).

## server-side deploy & verify

```bash
tar + scp backend/src/routes/admin/{dashboard.js,index.js} → server
pm2 reload resume-app-backend --update-env
```

| probe | 结果 |
|-------|------|
| no-auth GET /api/admin/dashboard/overview | **401** ✅ (R54 fix 起作用) |
| no-auth GET /api/admin/check | 401 ✅ (existing route) |
| R51 dev-bypass-active 在 prod NODE_ENV=production | 404 (R51 行为不变) |

服务器确认 deployment.

## baseline

- backend tests/admin-dashboard.test.js: 4 tests written (run gated by dev env / db isolation)
- mini-program tests 47/0/0 (含 R54 dashboard page 自动覆盖 via R48 tests)
- backend 服务端测试 425/0/1 (run gated)

R42 起 zero fail maintained.

## 决策

| # | 决策 | 原因 |
|---|------|------|
| 1 | 5 endpoint 拆细 vs 单 big response | 各自刷新 + cache-friendly |
| 2 | salary bucket 硬编码 | 数据可视化标准分桶; 用户可后续覆盖 |
| 3 | 大屏深色 + gradient bars | monitor-style; 与 ops Grafana 配合 |
| 4 | pull-down refresh | 业务数据需要定期 |
| 5 | dashboard admin 第一页 | 默认看数据; 其他操作 sub-route |
| 6 | dashboard self-apply auth via router.use (而非 inline per route) | adminAuth - **R54 follow-up fix**, 避免 mount 漏 auth |

## 已知 follow-up (R55+)

| # | 项 | 谁 |
|---|----|------|
| 1 | dev env npm test 整体 hang (db pool init timeout) | R55 排查 dev 不绑定 |
| 2 | 真机 audit: 用 IDE 实际看 dashboard 是否渲染 (需 user) | user |
| 3 | 1920×1080 全屏 view (admin sit in front) | R56 |
| 4 | R54 dashboard 真正在 prod DB 验 (R51 dev-bypass-active ENABLE_DEV_BYPASS=1 临时) | R55 ops |
| 5 | metrics + 趋势 date (DB only — 无 cache 层) | R56 |

## Commits

| SHA | msg |
|-----|-----|
| (本 devlog + 2 files) | feat(admin): R54 — dashboard API + adminAuth fix + mini-program 大屏 page |
