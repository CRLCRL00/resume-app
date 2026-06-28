# 开发日志 — 2026-06-28（Phase 4 验收）

> 阶段：4（管理端）
> 前置：[2026-06-28-phase3-verify.md](2026-06-28-phase3-verify.md)

## 今日目标

- [x] 后端：adminLog service + joi schemas (job + promptUpdate)
- [x] 后端：admin 路由拆分（check + jobs + prompts + logs）+ 26 新测试
- [x] 前端：分包 `admin/` + 5 页面 + 动态 tabBar
- [x] 前端：admin utils + 10 新测试
- [x] 服务器部署 + smoke test

## 关键指标

| 项 | 数值 |
|----|------|
| 后端代码 | 5 文件（services/adminLog + routes/admin/{check,jobs,prompts,logs} + middleware/validate 加 schema） |
| 后端测试 | 9 + 9 + 6 + 4 = 28 新（计划 26，实际 28） |
| 前端代码 | admin/ 分包（5 页面 × 4 文件）+ 2 utils + app.json + app.js |
| 前端测试 | 10 pass |
| Serverside | adminAuth + 4 路由 + 日志记录 |
| 踩坑 | 3（plan bug fix） |

## 服务器 smoke test

跑 `INSERT INTO admins (openid, note) VALUES ('admin_smoke', 'smoke')` 后用 JWT 调：
- `GET /api/admin/jobs?page=1&pageSize=5` → 200 + items + total
- `POST /api/admin/jobs` → 200 + job_id
- `GET /api/admin/logs?pageSize=5` → 200 + 含刚才 POST 的 'job.create' 日志

## 踩坑笔记

### 问题 1：plan 里 `parseSkills` 路径错
plan Task 10 给的是 `require('../../../utils/validate')`，但 `parseSkills` 在 `format.js`。submit 时会 throw。已修。

### 问题 2：plan 里 `wx.showModal(...).then(...)`
`wx.showModal` 返 `Promise<{confirm, cancel}>`，不是 thenable。已改成 `const modal = await ...; modal.confirm`。

### 问题 3：`.gitignore` `logs/` 误匹配
`mini-program/admin/pages/logs/` 被 `logs/` 匹配到，需 `git add -f`。修：把 `logs/` 改成 `/logs/`（只匹配根目录的 logs/）。

### 问题 4：adminAuth 鉴权双层
已用：`userAuth + adminAuth` 中间件链 + 前端 `wx.setTabBarItem`/`hideTabBar`。非 admin 调 admin 接口 → 403（已测试）。

### 问题 5：Prompt update 事务
`prompt.update` 用 transaction：先 UPDATE 老 active 为 0，再 INSERT 新 active=1 + 新 version。事务外写 admin_log（避免长事务）。

### 问题 6：TabBar dynamic
`wx.setTabBarItem` 不能新增 tab 只能更新现有 item。所以 app.json **必须预声明两个 tab**（首页 + 管理），初始 index=1 的"管理" 用 `wx.hideTabBar` 隐藏，`checkAdmin` 成功后 `wx.showTabBar`。

## 决策记录

**决策 1**：3 模块（岗位 + Prompt + 日志）— 用户选
**决策 2**：手动 SQL 注册 admin — 用户选
**决策 3**：动态 tabBar 入口 — 用户选
**决策 4**：列表加分页 — 用户选
**决策 5**：软删 + 恢复（不做回收站）— 用户选
**决策 6**：分包 root = `admin/` — 设计选择
**决策 7**：app.json 预声明两 tab + hide/show — 实现选择（plan 写的 setTabBarItem 不能 add tab）

## Phase 4 验收（来自 spec §1）

| # | 验收项 | 状态 |
|---|--------|------|
| 1 | 普通用户扫码 | ⏳ 真机待你验证 |
| 2 | admin 用户扫码 → 管理 tab | ⏳ 真机待你验证 |
| 3 | 管理 tab | ✅ 3 子页（jobs / prompts / logs）|
| 4 | 岗位 CRUD | ✅ list+create+edit+online+delete+restore + 日志记录 |
| 5 | Prompt 读改 | ✅ list+get+update (versioned) + 日志记录 |
| 6 | 日志查询 | ✅ list + pagination + 时间倒序 |
| 7 | 鉴权 | ✅ 401（无 token）+ 403（非 admin）|
| 8 | 日志记录 | ✅ 所有 admin 写操作记 log |
| 9 | 测试 | ✅ 后端 28 新 + 前端 10 新 |
| 10 | 服务器部署 | ✅ smoke test 通过 |

## 启动清单（Phase 4 用户手动）

1. ✅ 服务器 smoke data 已清
2. ⏳ **你手动注册 admin**：
   - 真机登录小程序（任意用户）
   - 服务器 SSH 查 openid：`SELECT openid FROM users ORDER BY id DESC LIMIT 1`
   - `UPDATE admins SET openid = '你的 openid', note = 'CRL' WHERE id = 1;`
3. ⏳ 真机重启小程序 → onLaunch 触发 checkAdmin → 显示「管理」tab

## 明日计划（Phase 5）

- [ ] Phase 5 设计：岗位匹配（粗筛 + LLM 精排 + 列表 + 详情）
- [ ] Phase 5 plan 文档
- [ ] 派子代理跑 Phase 5 任务
- [ ] 真机验收 Phase 4 管理端