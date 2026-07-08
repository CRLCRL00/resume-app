# 运维手册

本节给 ops / 值班 / SRE 用。

## 探活 & 性能

- [性能基准 (perf-bench)](/operations/perf-bench)
- [Smoke Test](/operations/smoke-test)

## 可观测

- [告警与指标阈值](/operations/alerts) — 8 条 in-process 告警 + Slack 路由
- [慢查询仪表盘](/operations/admin-queries) — ring buffer + admin 端点
- [Admin 操作审计](/operations/audit-logs) — 6 维过滤 + 180 天保留

## 安全

- [Admin 两步验证 2FA](/operations/two-factor) — TOTP + backup code + step-up

## 韧性

- [混沌测试场景](/operations/chaos-testing) — 7 个 fail-open 注入

## 紧急排错顺序

1. `/api/health` 返 200 吗？
2. `/api/internal/metrics/alerts` 看 firing alerts
3. `/api/admin/queries/slow` 看具体慢 SQL
4. `/api/admin/logs?result=failure` 看 admin 写失败
5. `pm2 logs resume-app-backend --lines 200`
