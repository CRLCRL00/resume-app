# Admin 操作审计 (R36)

> TL;DR：admin 所有写操作记 `admin_operation_logs`；GET 端点支持 6 维过滤 + distinct 端点；后台 cron 180 天保留。

## 表结构

```sql
admin_operation_logs
  id              PK
  admin_openid    VARCHAR(64)     -- 哪个 admin
  action          VARCHAR(64)     -- 'job.create' / 'prompt.update' / ...
  target_type     VARCHAR(32)     -- 'job' | 'prompt' | 'admin' | ...
  target_id       VARCHAR(64)     -- 目标主键
  detail          TEXT            -- JSON
  result          ENUM            -- 'success' | 'failure' | 'unknown' (R36)
  ip              VARCHAR(45)     -- IPv4 / IPv6
  created_at      DATETIME        -- 默认 CURRENT_TIMESTAMP
  INDEX idx_result (result)
  INDEX idx_action_time (action, created_at)
```

迁移：`backend/scripts/migration-005-audit-result.sql`（幂等）。

## 写路径

`backend/src/services/adminLog.js`:

```js
record(adminOpenid, action, targetType, targetId, detail, ip, result='unknown')
```

- `result` 默认 `'unknown'` → 旧调用方（无 result）零改动
- ENUM 白名单校验，非法值抛 `AppError(1000, 'invalid result', 400)`
- INSERT 加 `result` 列

中间件：`backend/src/middleware/adminAudit.js` 自动捕 admin 写操作的 status → 写 success / failure。

## 读端点

### `GET /api/admin/logs`

| Query | 类型 | 说明 |
|-------|------|------|
| `page` / `pageSize` | int | 默认 1 / 20；max 100 |
| `action` | string | **前缀匹配**（`action LIKE ?`） |
| `admin_openid` | string | 精确 |
| `target_id` | string | 精确 |
| `target_type` | string | 精确 |
| `result` | enum | `success` / `failure` / `unknown` |
| `ip` | string | 精确 |
| `dateFrom` / `dateTo` | ISO 8601 | `created_at >= ?` / `<=` |

`buildLogFilter()` 在 `routes/admin/logs.js` 里拼 WHERE + params。

### `GET /api/admin/logs/actions` (R36 distinct)

```sql
SELECT action, COUNT(*) AS count, MAX(created_at) AS last_at
FROM admin_operation_logs
GROUP BY action
ORDER BY count DESC LIMIT 100
```

给 ops 下拉选 action 用。

### `GET /api/admin/logs/actors` (R36 distinct)

```sql
SELECT admin_openid, COUNT(*) AS count, MAX(created_at) AS last_at
FROM admin_operation_logs
GROUP BY admin_openid
ORDER BY count DESC LIMIT 100
```

## 保留 cron (`jobs/adminLogsCleanup.js`)

- `runAdminLogsCleanup({ pool, retentionDays=180, batchSize=1000, logger })`
- 循环 batch DELETE 直到 `affected < batchSize`
- **min retention 30 天**（防误删参数）
- 幂等：第二次跑 0 deletes
- boot 5min 后首次 + 24h interval，`.unref()` + `isTestEnv` 短路

触发：

- 启动自动（`backend/src/index.js` 调 `scheduleAdminLogsCleanup()`）
- 手动：`POST /api/admin/logs/cleanup`（admin only，传 `{ retentionDays }`）

## 归档表

`admin_operation_logs_archive`（R28 加）：`POST /api/admin/logs/archive` 把过期数据搬运过去。R36 的 retention cron 删的是原表，archive 表保留更久。

## 已知限制

- `target_type` / `target_id` 没独立索引，命中现有 `idx_action_time` 靠前缀（`action LIKE 'job.%'` 会用上 action 部分）
- 旧 adminLog 调用方（无 result）写入默认 `unknown`——R36 起应**统一传 result**，但**未强制**
- `detail` 是 TEXT 无 schema，结构由调用方决定

## 排查示例

| 问题 | 查询 |
|------|------|
| 昨天谁删了 job | `?action=job.delete&dateFrom=2026-07-04T00:00:00Z` |
| 某个 admin 全部失败 | `?admin_openid=oXxx&result=failure` |
| 某 IP 操作 | `?ip=1.2.3.4` |
| 失败的 prompt 更新 | `?action=prompt.update&result=failure` |
