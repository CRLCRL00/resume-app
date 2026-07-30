# 开发日志 — 2026-07-01（Phase 8+ Round 15）

> 阶段：8+ Round 15
> 前置：[2026-07-01-phase8-plus-round14.md](../devlog/2026-07-01-phase8-plus-round14.md)

## 目标

3 个 hardening 项：
A. CI dep audit + alerts retry
B. admin user CRUD UI
C. perf histogram + 慢查询

## 最终结果

| 项 | 状态 |
|----|------|
| A CI dep audit step | ✅ workflow 加 audit step |
| A alerts retry block | ✅ Round 14 已含；本轮 verify |
| B admin user CRUD | ✅ GET/POST/DELETE + 小程序 UI |
| C perf histogram | ✅ http_request_duration_seconds + slowOps |
| npm test 3x | ✅ 135/136 × 3 绿 |

## 改动详情

### A — CI dep scan

`.github/workflows/backend-test.yml`:
```yaml
- name: Dep audit (production)
  working-directory: backend
  run: |
    npm audit --omit=dev --registry https://registry.npmjs.org/ \
      || (echo '::warning::Dep audit reported vulnerabilities'; exit 0)
```
非阻塞 warn；0 vulnerabilities 平静过。

### B — admin user CRUD

后端：`routes/admin/admins.js`
- GET /api/admin/users（page/pageSize）
- POST /api/admin/users（添加 admin + 自动确保 user row）
- DELETE /api/admin/users/:openid（不能删自己 + admin only）
- 全部写 admin_operation_logs

小程序：`admin/pages/admins/admins.{js,wxml,wxss,json}`
- 当前 admin 列表 + 添加表单 + 单击移除
- me.js 加 ⚙ Admin 用户管理入口

### C — perf histogram

`metrics.js`:
- `http_request_duration_seconds`（Histogram）— method/route/status label
- `slow_operations_total`（Counter）— duration > 1s

`app.js` middleware:
```js
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const dur = (Date.now() - t0) / 1000;
    m.httpDuration.observe({...}, dur);
    if (dur > 1) m.slowOps.inc({...});
  });
  next();
});
```

⚠️ 高基数 label 风险：route 太多可能爆 metrics 索引。当前受限于用户实际点击的 route。

## 服务部署 verify

```
$ /api/admin/users (user 8 non-admin)
{"code":1003,"message":"admin only"}  ✓ route mounted + auth

$ /api/internal/metrics
http_request_duration_seconds_bucket{le="0.01",...,route="/users",status="403"} 0
http_request_duration_seconds_bucket{le="0.25",...,route="/users",status="403"} 1
✓ histogram bucketing OK
```

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A npm audit 不阻塞 | dep CVE 需手动升级；不强制 cycle gate |
| 2 | B admin 不能删自己 | 防误锁 |
| 3 | B 添加 admin 自动确保 user row | 简化 UX |
| 4 | C 默认 1s 慢阈值 | LLM 5-10s 是预期，不告警；只显真慢 |
| 5 | C route 字符串 fallback | histogram labels 兼容 baseUrl+route.path |

## 风险

| 风险 | 缓解 |
|------|------|
| A npm audit 慢 | fail-open（不阻塞 CI） |
| B 多 admin + audit log 增长 | Round 13 archive 表已备 |
| C 高 route label 耗 prom 内存 | 监控 route 数量；后续可聚合 |

## Commits
`{pending}`
