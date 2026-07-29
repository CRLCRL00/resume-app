# 沙箱可跑测试 Runbook

> 哪些测试可以在 claude 沙箱里跑通 (不需要 DB),哪些必须本地执行。

## ✅ 沙箱可跑 (63 个测试,无 DB)

| 文件 | 测试数 | 备注 |
|------|--------|------|
| `tests/unit-parseLlmJson.test.js` | 20 | LLM JSON 解析 (4 种 fallback) |
| `tests/unit-jobFilter.test.js` | 22 | 粗筛逻辑 (userYears / parseExpReq / coarseFilter) |
| `tests/service-jobFilter.test.js` | ? | coarseFilter 单元测试 |
| `tests/service-resumeTemplate.test.js` | ? | renderResume 模板渲染 |
| `tests/sanitize.test.js` | ? | sanitizeForLlm |
| `tests/wechat.test.js` | ? | 微信登录流程 |

## ❌ 沙箱跑不动 (需要本地 DB)

**原因**: 大多数测试文件 require `helpers/db` 或 `config/db`,沙箱里 DB 连接受限,test.before() hang 在 `getPool().query(...)`。

### 受影响的测试类型

1. **DB-dependent 单元测试**:
   - `tests/service-matchService.test.js`
   - `tests/service-jobpilot-applications.test.js` (我新加的)
   - `tests/service-resumeGenerator.test.js`
   - `tests/service-matchPrompt.test.js`
   - `tests/service-resumePrompt.test.js`

2. **HTTP 集成测试** (需要 mock auth + DB):
   - `tests/route-jobpilot.test.js` (我新加的)
   - `tests/route-*.test.js` (其他路由测试)

3. **任何 import `createApp()` 的测试**:
   - createApp 间接 require DB (config/db → createPool)

## 🎯 跑测试的命令

### 沙箱可跑 (已验证)
```bash
cd backend
timeout 15 node --test \
  tests/unit-parseLlmJson.test.js \
  tests/unit-jobFilter.test.js \
  tests/service-jobFilter.test.js \
  tests/service-resumeTemplate.test.js \
  tests/sanitize.test.js \
  tests/wechat.test.js
# 预期: 63 tests pass, ~900ms
```

### 本地跑全部
```bash
cd backend
mysql resume_app < db/migrations/jobpilot.sql  # 先跑 SQL
npm test                                          # 跑 130+ 测试
```

## 📊 沙箱 vs 本地测试分布

| 类型 | 沙箱可跑 | 本地跑 | 总数 |
|------|----------|--------|------|
| 纯逻辑 unit | ✅ 42 | ✅ | 42 |
| 纯逻辑 service | ✅ ~21 | ✅ | ~21 |
| DB-dependent | ❌ | ✅ | ~30 |
| HTTP 集成 | ❌ | ✅ | ~30 |
| **沙箱跑通的** | **63** | | |
| **写好的** | | | **~120+** |

## 💡 增加沙箱可跑测试的建议

未来写测试时,优先写 **纯逻辑** 测试 (no DB):
- 输入 → 输出 转换 (parser, formatter)
- 纯函数 (utils, helpers)
- mock 友好 (可以 stub 外部依赖)

DB 测试 (SQL 逻辑、HTTP 集成) 留给本地测试。

## 🚨 注意事项

1. 沙箱里 `node --test tests/X` 不带 timeout 会一直 hang (DB 等不到)
2. `npm test` 在沙箱也会 hang (npm test 跑所有 test/*.test.js)
3. 必须用 `timeout N` 命令限时
4. 看哪些测试 hang 的简单方法: 单独跑每个测试文件,5 秒 timeout,挂的就是用了 DB

## 📌 这次跑通的成就

- ✅ 沙箱可跑测试从 0 → **63 个**
- ✅ 修了 `matchService` 向后兼容 bug (SQL migration 不跑也能 work)
- ✅ 新加 `parseLlmJson` 工具 (20 tests)
- ✅ 新加 `jobFilter` 测试 (22 tests)

**未来**: 沙箱跑通的越多,改代码的信心越大。