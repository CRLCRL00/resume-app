# Admin Audit List — 2026-07-02

## 目标

加 `GET /api/admin/audit` 只读 endpoint 让 admin 能查 admin_audit 表。

## 改动

- 路由文件拆分：`backend/src/routes/admin/index.js` + 新 `backend/src/routes/admin/audit.js`
- 路由 handler：`audit.js:21`
- mount：`admin/index.js:10`（Round 1 已 wired，无须改 index.js）

## 查询支持

| 参数 | 类型 | 备注 |
|------|------|------|
| openid | string | exact match |
| action | string | LIKE %action% |
| target_type | string | exact |
| target_id | string | exact |
| status | string | `2xx` / `4xx` / `5xx` range |
| since | ISO date | created_at >= |
| until | ISO date | created_at <= |
| limit | number | default 50, max 200 |
| offset | number | default 0 |

response: `{ code: 0, data: { rows, total, limit, offset } }`

## auth

`userAuth + adminAuth` 中间件链 — JWT 解析 + admins 表 openid 白名单。

## 测

`backend/tests/adminAuditList.test.js`：5 用例（no-auth 401 / admin token 200 / openid filter / limit cap / status range）。

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 204 | 201 | 2 | 1 |
| 2 | 204 | 201 | 2 | 1 |
| 3 | 204 | 201 | 2 | 1 |

baseline 199 → 204（+5 adminAuditList tests）。2 fail pre-existing（authLockout state pollution）。

## 决策

| # | 决策 | 原因 |
|---|------|------|
| 1 | routes/admin/ 子目录拆分 | jobs/audit 已存在（Round 19 audit.js），按模块归位 |
| 2 | status 用 range 字符串而非数字 | admin 心智模型：4xx = 失败操作集合 |
| 3 | since/until 而非 from/to | follow 上线 admin jobs/list 已有命名 |
| 4 | test 用唯一 openid (`test_audit_admin_${ts}`) | 避免跨 run 残留污染 |
| 5 | limit 上限 200 | 防 table scan DOS |

## 风险

| 风险 | 缓解 |
|------|------|
| admin auth bypass | 双层：JWT + admins 表 |
| 长 SQL IN/LIKE 无 escape | 用 `?` placeholder + params 数组 |
| status range 误判边界 | 2xx = 200-299 / 4xx = 400-499 / 5xx = 500-599 |

## Commits

| SHA | msg |
|-----|-----|
| `6fe2147` | feat(audit): GET /api/admin/audit 分页 + 过滤 |
