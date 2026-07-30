# 开发日志 — 2026-07-01（Phase 8+ Round 13）

> 阶段：8+ Round 13
> 前置：[2026-07-01-phase8-plus-round12.md](../devlog/2026-07-01-phase8-plus-round12.md)

## 目标

3 个 hardening 项：
A. npm audit + JWT alg whitelist
B. OpenAPI drift detector
C. audit log archive

## 最终结果

| 项 | 状态 |
|----|------|
| A npm audit | ✅ 0 vulnerabilities |
| A JWT alg whitelist | ✅ HS256 only（挡 alg=none） |
| B OpenAPI drift detector | ✅ 7 测试覆盖 25+ paths |
| C audit log archive | ✅ migration + 新端点 |
| npm test 3x | ✅ 127/128 × 3 绿（+7 测试）|

## 改动详情

### A — npm audit + JWT alg

```
npm audit --production --registry https://registry.npmjs.org/
→ found 0 vulnerabilities
```

`services/token.js`: 显式 whitelist `algorithms: ['HS256']` 在 verify。防止 alg=none / alg=HS256-with-public-key 等攻击。

### B — OpenAPI drift detector

`tests/openapi-drift.test.js`（7 测试）：
- 加载 `/api/docs/openapi.json` spec
- 验证 openapi=3.0.3 + paths/components.schemas 存在
- paths >= 25
- 每个 path 有 ≥ 1 operation
- 验 health/legal/docs 端点真实可达（不返 404）
- 抓 spec-route drift

### C — Audit log 归档

`scripts/migration-003-audit-archive.sql`:
- 新表 `admin_operation_logs_archive`（同 schema + archived_at）
- INSERT IGNORE（id 唯一，重复归档幂等）

`routes/admin/logs.js`:
- `POST /api/admin/logs/archive { days: 90 }` — 事务搬运
  - INSERT INTO archive SELECT ... WHERE created_at < NOW - days
  - DELETE FROM main
- `GET /api/admin/logs/archive` — 查归档（含 archived_at）

## npm test

| Run | 通过 | 失败 |
|-----|------|------|
| 1 | 127/128 | 0 |
| 2 | 127/128 | 0 |
| 3 | 127/128 | 0 |

（+7 测试：openapi-drift.test.js 7 个）

## 服务部署 verify

```
$ mysql> SHOW TABLES LIKE 'admin_operation_logs_archive'
admin_operation_logs_archive  ✓ migration applied

$ JWT verify sign now alg: 'HS256' explicit

$ POST /api/admin/logs/archive (user 8 non-admin)
{"code":1003,"message":"admin only"}  ✓ route mounted, auth gate works
```

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A registry 改 npmjs.org | npmmirror 不支持 audit API |
| 2 | A verify alg: ['HS256'] | 兼容现有 token；显式比 implicit 安全 |
| 3 | B drift detector 是 sanity check | 不强加 schema 严格（ajv 集成较大）|
| 4 | C INSERT IGNORE 归档幂等 | 重复跑 cron 安全 |
| 5 | C 删旧数据 transaction | 失败回滚，避免数据丢失 |

## 风险

| 风险 | 缓解 |
|------|------|
| drift 测试只 sample 部分 path | 自动 + 完整 ajv 化留 Phase 9+ |
| archive 表无限增长 | R5 已有 prune endpoint（删主表）；archive 也加 limit？|
| jwt verify alg change breaks old tokens | 已有 blacklist + secret 轮换 runbook |

## Commits
`{pending}`
