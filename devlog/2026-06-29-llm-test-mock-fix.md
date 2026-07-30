# 开发日志 — 2026-06-29（LLM Test Mock 修复）

> 阶段：6+（npm test 5 fail 修复）
> 前置：[2026-06-29-npm-test-hang-fix.md](2026-06-29-npm-test-hang-fix.md)
> Spec：[2026-06-29-...-llm-test-mock-design.md](../docs/superpowers/specs/2026-06-29-简历推荐小程序-llm-test-mock-design.md)

## 目标

5 个 LLM 路径测试稳定通过。

## 最终结果

| Run | 通过 | 失败 |
|-----|------|------|
| 1   | 111/111 | 0 |
| 2   | 111/111 | 0 |
| 3   | 111/111 | 0 |
| 4   | 111/111 | 0 |
| 5   | 111/111 | 0 |

**5/5 全绿，0 flakiness**。

## 根因（确认）

1. **DeepSeek API key 失效**：`sk-0cb4...f3caca` 已撤销
2. **mock pattern 脆弱**：手工 orig/restore 在 body throw 时不执行
3. **跨 run redis 污染**：`generate:1` rateLimit key 在 npm run 之间持久化 → 4+ 次 INCR 后 429

## 已落地

### 文件改动

| 文件 | 改动 |
|------|------|
| `tests/helpers/llm.js` | 新建 — cache ORIG + stubChat/Json + restoreAll |
| `tests/service-matchService.test.js` | 改 helper + beforeEach restoreAll + test 1 加 defensive stub |
| `tests/route-resume-generate-llm.test.js` | 改 helper + beforeEach restoreAll + 清 generate:1 |

总计 **3 文件改动**，~50 行新增/修改。

### Commits

```
2fc68db test(generate-llm): clear generate:1 rateLimit key in beforeEach
f52c30a test: use llm mock helper in matchService + generate-llm tests
3251dd0 test(backend): add tests/helpers/llm.js for LLM mocking
13b9c8d docs(spec+plan): LLM test mock helper (A: auto-restore)
```

## 验收（5x 全量 npm test）

| 维度 | 状态 |
|------|------|
| 测试数 | 111 |
| 通过 | 111/111 × 5 |
| 失败 | 0 |
| 耗时 | ~10.5s/run（稳定）|
| 退出码 | 0 |

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | 全自动 mock helper（用户选） | beforeEach 兜底解决 mock leak |
| 2 | module-load-time ORIG 捕获 | llm.js 函数引用稳定 |
| 3 | beforeEach 清 generate:1 | 跨 run redis 持久污染 |
| 4 | matchService test 1 加 defensive stub | 即便 DB 有候选也不会真调 LLM |
| 5 | 修 `jobs WHERE city='深圳' AND title<>'match_test_job'` | jobs 表无 source 列（plan 适应调整）|

## 已知遗留

- DeepSeek API key 仍需新有效 key（生产 / dev 不在测试范围）
- Pre-existing stderr noise：`[31merror[39m: [object Object]` 来自 errorHandler（不影响 test pass）

## Phase 7 启动清单（更新）

- [x] npm test hang 修
- [x] LLM test mock 修（111/111 稳定绿）
- [ ] DeepSeek API key 修复或测试 mock LLM（不影响 test，已 mock 化）
- [ ] service-rateLimit 依赖注入重构（可选）
- [ ] Phase 7 设计（微信审核准备）
- [ ] 真机生产验
