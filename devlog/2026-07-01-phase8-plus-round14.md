# 开发日志 — 2026-07-01（Phase 8+ Round 14）

> 阶段：8+ Round 14
> 前置：[2026-07-01-phase8-plus-round13.md](../devlog/2026-07-01-phase8-plus-round13.md)

## 目标

3 个 hardening 项：
A. HMAC test 覆盖 + monitor webhook retry x3
B. admin legal-version UI（小程序）
C. stage env 实施指南

## 最终结果

| 项 | 状态 |
|----|------|
| A1 HMAC test | ✅ 8 测试覆盖（成功+8 种 fail 场景） |
| A2 monitor retry x3 | ✅ 退避 2s/4s |
| B admin legal-version UI | ✅ admin subpackage 加 legal/legal.* |
| C stage env 指南 | ✅ docs/audit/stage-env-setup.md |
| npm test 3x | ✅ 135/136 × 3 绿（+8 测试）|

## 改动详情

### A1 — HMAC 测试

`tests/alerts-hmac.test.js` 8 测试：
- 缺 token → 401
- bad token → 401
- skewed timestamp (±10 min) → 401
- 缺 timestamp → 401
- bad signature → 401
- tampered body → 401
- ✅ 完整签名 → 200 received
- 签名缺 `sha256=` 前缀 → 401

### A2 — monitor retry

`scripts/monitor.sh` webhook 调用：
```bash
for attempt in 1 2 3; do
  HTTP_C=$(curl ... -X POST ...)
  if [ "$HTTP_C" = "200" ]; then break; fi
  [ "$attempt" -eq 3 ] && break
  sleep $((attempt * 2))   # 2s, 4s 退避
done
```

### B — admin legal-version UI

新 `mini-program/admin/pages/legal/legal.{js,wxml,wxss,json}`：
- 当前版本展示（privacy / terms）
- 表单：doc_type + version (YYYY-MM-DD) + note
- 提交 → `POST /api/admin/legal-version`
- 操作写 admin_operation_logs

`app.json` 注册 subpackage page。`me.js + me.wxml` 加 ⚖ 法务文档版本 admin 链接。

### C — stage env 指南

`docs/audit/stage-env-setup.md`：
- 与生产差异表
- 一次性创建步骤（DB + .env + PM2）
- CI/CD 草案
- 数据同步（脱敏 + 加密）
- 校验表
- 推广决策
- 当前状态（未启用，Phase 9+ 再启）
- 升级步骤（1 工作日）

## npm test

| Run | 通过 | 失败 |
|-----|------|------|
| 1 | 135/136 | 0 |
| 2 | 135/136 | 0 |
| 3 | 135/136 | 0 |

（+8 测试 alerts-hmac）

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A retry 退避 2s/4s | 网络抖动简单恢复 |
| 2 | B admin legal UI 入口放 me 页 | admin 入口集中 |
| 3 | C stage 用独立 DB name | 隔离生产数据 |

## 风险

| 风险 | 缓解 |
|------|------|
| A retry 卡 10s 后失败 | 设上限 3 次；监控 log 标记 |
| B admin legal UI 用户体验 | 简化版；可扩展 |
| C stage 与 prod 同时改易乱 | 文档明确步骤；CI 自动 |

## Commits
`{pending}`
