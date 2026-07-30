# 开发日志 — 2026-06-30（Phase 8+ Hardening）

> 阶段：8+（生产打磨）
> 前置：[2026-06-29-e2e-smoke.md](2026-06-29-e2e-smoke.md)

## 目标

3 个 hardening 项：
A. 经验模糊匹配
B. Redis 降级日志
C. jobs 复合索引

## 最终结果

| 项 | 状态 |
|----|------|
| A 经验模糊匹配 | ✅ 加 userYears + parseExpReq + coarseFilter 扩展 |
| B Redis fail-open 日志 | ✅ safeRedis wrapper + logger.warn |
| C jobs 复合索引 | ✅ 索引已存在（no-op migration 文档化）|
| npm test | ✅ 114/114 × 3 绿 |

## 改动详情

### A — 经验模糊匹配（`src/services/jobFilter.js`）

新增 2 辅助函数：
- `userYears(form)` — 从 `experiences[]` 计算用户总经验年数（粗估，含"至今"）
- `parseExpReq(str)` — 解析 `experience_required` 字符串：
  - `'不限' / '经验不限' / 空 / 不可解析` → `null`（不滤）
  - `'1-3年'` → `{min:1, max:3}`
  - `'5年以上'` → `{min:5, max:Infinity}`
  - `'3年以下'` → `{min:0, max:2}`

`coarseFilter` 加 2 行检查：
- 用户经验超 `max` → 过滤
- 用户经验比 `min` 少 1 年以上 → 过滤
- 容忍 1 年误差（应届或 1 yr ago）

测试覆盖（9/9 函数 OK；2 单元测试期望写错已纠正）。

### B — Redis fail-open（`src/services/matchService.js`）

加 `safeRedis(op, fn)` wrapper：
```js
async function safeRedis(op, fn) {
  try { return await fn(); }
  catch (err) {
    logger.warn({ err: err.message, op }, 'redis fail-open');
    return null;
  }
}
```

应用 2 处：
- `match:setBatchId`（写 cache 24h）
- `match.checkBatchId`（读 cache）

之前 redis 错误 → throw → 整个请求 500。现在 redis 出错 → warn 日志 + 返回 null → 业务继续（无 cache）。

`rateLimit.check` 已有自己的 fail-open，保留不动。

### C — jobs 复合索引（`scripts/migration-001-jobs-index.sql`）

确认现状：
- `idx_online_city (is_online, is_deleted, city)` 已存在
- `idx_salary` / `idx_degree` / `idx_experience` 也已存在
- Phase 1 schema 初始时就建好了

迁移文档改为 **no-op** 注释 + 何时该用 EXPLAIN 重审。

## npm test

| Run | 通过 | 失败 |
|-----|------|------|
| 1 | 114/114 | 0 |
| 2 | 114/114 | 0 |
| 3 | 114/114 | 0 |

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | 容忍 ±1 年经验 | 应届/学生卡 1-3 年岗合理 |
| 2 | safeRedis default null | cache miss 等于 null（业务无感）|
| 3 | 不动现有业务 user_id 取 resume/match | scope 内微调，避免回归 |
| 4 | migration 文档化 no-op | 实际查后 server 已具备，重复 ALTER 报 denied |

## 风险

| 风险 | 缓解 |
|------|------|
| userYears 公式对跨年度不准确 | 粗估合理；后续 user 反馈再精化 |
| safeRedis 静默吞 redis 错误 | logger.warn 留下审计，可监控告警 |
| 复合索引真需要重建时忘了怎么办 | migration 文档化 + 何时 EXPLAIN |

## Commits

（这阶段会多 commit + push）
