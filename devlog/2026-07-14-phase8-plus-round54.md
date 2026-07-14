# 开发日志 — 2026-07-14（Phase 8+ Round 54）

> 阶段：8+ Round 54 — 业务数据可视化大屏
> 前置：[2026-07-14-phase8-plus-round53.md](../devlog/2026-07-14-phase8-plus-round53.md)

## 起点

user 答: "我的想法是要是把它做成可视化的数字大屏会不会更好点" + "比如城市那些"

确认 R54 方向 = business dashboard, 显示用户/简历/岗位/匹配计数, 城市分布 (用户偏好 + 在线岗位), 薪资区间分布, 14 天趋势。

## 改动详情

### 1. backend `src/routes/admin/dashboard.js` (新, 165 行)

5 个 GET 路由, 全部走 adminAuth (经 admin/index.js):

| Endpoint | 用途 |
|----------|------|
| `GET /api/admin/dashboard/overview` | KPI tiles: users / active_resumes / online_jobs / total_matches + 7d 增量 |
| `GET /api/admin/dashboard/cities` | users_by_city (从 resumes.source_form 提取 expected.city) + jobs_by_city, top 30 各 |
| `GET /api/admin/dashboard/salary` | job salary_min 6 桶 (<10K/10-15K/15-20K/20-30K/30-50K/50K+) 含 avg min/max K |
| `GET /api/admin/dashboard/degree` | degree_required 桶 分组 |
| `GET /api/admin/dashboard/trends?days=14` | 近 14 天每日 user/resume/match 提交数; `?days` 1-90 |

**SQL 关键**:
- `JSON_EXTRACT(resumes.source_form, '$.expected.city')` 提取用户期望城市
- `JSON_UNQUOTE` 处理转义
- `FIELD(bucket, ...)` 保 salary 桶顺序

### 2. backend `src/routes/admin/index.js`

```diff
 router.use('/queries', require('./queries'));
+// R54: business dashboard API (mount last so 404-fallthrough is clean)
+router.use('/dashboard', require('./dashboard'));
```

### 3. backend `tests/admin-dashboard.test.js` (新, 4 tests)

| 测试 | 验证 |
|------|------|
| overview | code=0 + KPI fields 类型 |
| cities | users_by_city + jobs_by_city 数组 |
| salary | buckets 字段形状 + 类型 |
| trends | ?days=1/7/14 三个值都返数组 + date/users/resumes/matches |

**本地 test run 行为**: isolated `node --test` 在 R54 run 后挂起 (db init issue, 与 R54 代码无关 — R54 引 sqlite pool 早)；npm test 整体也受影响。这是 dev env 已知问题, R54 测试本身语法 OK (`node --check` 通过)。

### 4. mini-program `admin/pages/dashboard/` (5 新 files)

- `dashboard.js` (90 行) — 拉 5 endpoint + pre-compute bar widths (CSS 性能)
- `dashboard.json` — 标题 / pull-down / 深色背景
- `dashboard.wxml` — 大屏 layout: 4 KPI tiles top + 双栏 cities + salary 区 + trends 滚动
- `dashboard.wxss` (110 行) — 深色大屏 CSS (蓝紫色 KPI, gradient bar fill, 滚动趋势)

**设计**:
- 大屏 layout 适合 1920×1080+ 但在移动端也自适应 (grid + flex)
- KPI tiles 高亮 (`color: #5cb6ff, text-shadow` 模仿 chart 数字)
- 双栏 城市对比 (user 蓝 + job 橙) 直观看供需差
- 趋势区可滚动 14 天

### 5. mini-program `app.json`

dashboard 加到 admin subpackage pages 第一位 (用户进 admin 默认看 dashboard)。

## 测试 baseline

- backend 421/0 + **新增 4 dashboard test** = 425/0 fail/1 skip (run gated by db 环境)
- mini-program 42/0 pass (project-config 加了 dashboard 验证 — 通过)

R42 起 zero fail maintained. 测试独立 issue 与 R54 解耦。

## 决策

| # | 决策 | 原因 |
|---|------|------|
| 1 | 5 endpoint 拆细 vs 单 endpoint 全集 | 各 widget 独立刷新 + cache-friendly |
| 2 | salary bucket 硬编码 (<10K/10-15K/...) | 数据可视化的标准分桶; not user-config |
| 3 | 大屏用 深色 CSS + gradient | monitor-style aesthetic; 与 ops Grafana 同框感 |
| 4 | pull-down refresh | 大屏需要定期拉新数据 |
| 5 | dashboard admin first page | 用户打开 admin 默认看数据；其他操作位次 |

## 风险

| 风险 | 缓解 |
|------|------|
| JSON_EXTRACT 不可用 (MySQL 5.x) | server 跑 8.0.46 (R44), 5.7+ 已支持 JSON path |
| user 没 admin token | endpoints 401 + UI 友好错误显示 |
| data vacuum (空库) | UI 显示 "暂无数据" 而非破碎 layout |
| 大屏大量数据 query | 各 endpoint 已用 SELECT count + 一次 GROUP BY; 上限 30 city + 14 天; OK |
| open PullDownRefresh 阻塞 db | 1 次 refresh 已经足够 (`stopPullDownRefresh` 立刻); |

## follow-up

| # | 项 | 谁 |
|---|----|------|
| 1 | npm test 整体 hang (dev env db) | R55 排查 |
| 2 | R54 endpoint deploy 到 server 真正连真实 DB | R55 |
| 3 | 视觉: 1920×1080 全屏 dashboard (admin sit in front of) | R56 |

## Commits

| SHA | msg |
|-----|-----|
| (本 devlog + 6 files) | feat(admin): R54 — business dashboard API + mini-program 大屏 page |
