# LLM Test Mock 自动化 设计

> 阶段：6+（npm test 5 fail 修复）
> 前置：[2026-06-29-npm-test-hang-fix.md](../../devlog/2026-06-29-npm-test-hang-fix.md)
> 决策方案：A 全自动 mock helper（用户选）

## 目标

修复 npm test 中 5 个 LLM 路径测试稳定/不稳定失败：

| # | 测试 | 失败原因 |
|---|------|----------|
| 1 | `service-matchService.test.js: match returns empty when no candidates` | 真 LLM 被调（DB 候选任务残留）→ API key 无效 → 502 |
| 2 | `route-resume-generate-llm.test.js: hits DB cache when content_md exists` | mock leak — body throw 时 restore 不执行 |
| 3 | `.../calls LLM when no cache and stores result` | mock leak 同 #2 |
| 4 | `.../returns 502 on LLM failure` | mock leak 同 #2 |
| 5 | `service-matchService.test.js: match rejects invalid job_ids` 等 | 偶尔同 #2 |

## 根因

1. **DeepSeek API key (R42 之前已撤销，`sk-...` form) 已失效**（环境 `.env` 中残留）— R45 抹去具体值
2. **mock pattern 脆弱**：`const orig = chat; llm.chat = stub; ... llm.chat = orig;` 在 body throw 时不执行 restore
3. **Node module cache 跨文件共享**：5 个测试文件共用同一 llm module 实例，跨文件 stub 残留

## 架构

新建 `tests/helpers/llm.js`：
- 缓存模块加载时的真实 `chat` / `chatJson` 引用
- `stubChat(fn)` / `stubChatJson(fn)` 装 stub
- `restoreAll()` 全部还原（任何路径都保证还原）

测试文件改用：
```js
const { stubChat, stubChatJson, restoreAll } = require('./helpers/llm');

test.beforeEach(() => {
  restoreAll();  // 清上个测试残留 stub
});

test('XXX calls LLM', async () => {
  stubChatJson(async () => ({ parsed: {...}, usage: {} }));
  // body throws? beforeEach on next test cleans up
});
```

## 组件

### `tests/helpers/llm.js`

```js
const llm = require('../../src/services/llm');

const ORIG = {
  chat: llm.chat,
  chatJson: llm.chatJson,
};

function stubChat(fn) {
  llm.chat = fn;
}

function stubChatJson(fn) {
  llm.chatJson = fn;
}

function restoreAll() {
  llm.chat = ORIG.chat;
  llm.chatJson = ORIG.chatJson;
}

module.exports = { stubChat, stubChatJson, restoreAll, ORIG };
```

### 测试文件改法

**Before**（脆弱）:
```js
const { chat } = require('../src/services/llm');
// ...
const orig = chat;
require('../src/services/llm').chat = async () => ({...});
// body
require('../src/services/llm').chat = orig;  // body throw 不执行
```

**After**（强保证）:
```js
const { stubChat, stubChatJson, restoreAll } = require('./helpers/llm');

test.beforeEach(() => {
  restoreAll();
});

test('XXX', async () => {
  stubChat(async () => ({...}));  // 或 stubChatJson
  // body throws? 下一个 test 的 beforeEach 清
});
```

### `service-matchService.test.js` test 1 强化

测试 1 期望「无候选任务」，但 DB 中可能有 seed data 残留。fix：
```js
test('match returns empty when no candidates', async () => {
  await pool.query("DELETE FROM jobs WHERE title = 'match_test_job'");
  // 兜底：清掉所有候选避免粗排命中
  await pool.query("DELETE FROM jobs WHERE city = '深圳' OR source = 'seed'");
  await pool.query("DELETE FROM matches WHERE user_id = ?", [TEST_USER]);
  await redis.del(`match:batch:${TEST_USER}:1`);

  // 防御：即使粗排命中也走 mock，不打真 LLM
  const { stubChatJson } = require('./helpers/llm');
  stubChatJson(async () => ({ parsed: { results: [] }, usage: {} }));

  const resumeId = await insertResume('');
  const result = await matchService.match(TEST_USER, resumeId);
  assert.deepEqual(result.results, []);
  await pool.query('DELETE FROM resumes WHERE id = ?', [resumeId]);
});
```

## 生命周期

```
[file load] → require('./helpers/llm')
              ORIG = 当前 llm.chat / chatJson 的真实引用
              
[each test]
  beforeEach: restoreAll() ← 还原到 ORIG，保证上 test 残留清
  body: stubChat(...)     ← 替换（测试一结束 beforeEach 清）
  
[App code] → callSite 使用 llm.chat / llm.chatJson ← namespace lookup at call time
             matchService.js: const llm = require('./llm'); llm.chatJson(...)
             resumeGenerator.js: 同上
             已确认这 2 个 file 是 namespace import。OK。
```

## 错误处理

| 场景 | 行为 |
|------|------|
| body throw | beforeEach 在下 test 清 stub，process 不卡 |
| stub 设了但忘了 restore | beforeEach 兜底 |
| ORIG 与当前 llm 不一致（罕见）| restore 还原到 ORIG（早期真实引用） |

## 不做

- 不重构 llm.js 接受依赖注入（Phase 7+）
- 不换测试框架
- 不动 matchService / resumeGenerator / 路由源码（已 namespace import OK）
- 不 mock axios 层（粒度太粗）

## 风险

| 风险 | 缓解 |
|------|------|
| ORIG 捕获过早（llm.js 还没初始化）| 加载时立即捕获（llm module 加载即初始化 chat / chatJson 函数引用）|
| 跨进程污染 | 不影响 — Node CLI 重启 module 重加载 |
| Helper 路径错 | helper 自身测试覆盖 |

## 验收

```bash
cd backend
for i in 1 2 3 4 5; do
  npm test 2>&1 | grep -E "^ℹ (pass|fail|tests)"
done
# 期望：5 runs ≥ 4 runs pass 110/111 或更好
# 期望：1 fail 0（之前是 1 stable + 4 flaky）
```

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A 全自动 mock helper（用户选） | 复用 + 强保证 + 简单 |
| 2 | module-load-time ORIG 捕获 | llm.js 函数引用稳定，不变 |
| 3 | beforeEach 兜底而非 try/finally | node:test 模式一致，代码简洁 |
| 4 | matchService test 1 兜底加 stub | 即使 DB 有残留也不打真 LLM |

## 不在范围

- 修 DeepSeek API key（用户安全管控，不在我们工作流）
- 修 mock pattern 的所有非 fix 失败源（仅修 5 个）
