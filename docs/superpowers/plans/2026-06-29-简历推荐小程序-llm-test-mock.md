# LLM Test Mock 落地计划

> Spec：[2026-06-29-...-llm-test-mock-design.md](../specs/2026-06-29-简历推荐小程序-llm-test-mock-design.md)
> 决策：A 全自动 mock helper

## 一、目标

5 个 LLM 路径测试 100% 通过稳定。3x npm test 0 fail。

## 二、任务

| ID | 文件 | 动作 | 前置 |
|----|------|------|------|
| T1 | `tests/helpers/llm.js` | 新建：cache ORIG + stubChat/Json + restoreAll | 无 |
| T2 | `tests/service-matchService.test.js` | 5 个测试改用 helper；test 1 加 defensive stub | T1 |
| T3 | `tests/route-resume-generate-llm.test.js` | 5 个 mock 测试改用 helper；删手动 orig/restore | T1 |
| T4 | 验证 | 3-5x npm test 全 ≥110/111 | T2/T3 |

## 三、helper 内容（spec 完整版）

```js
const llm = require('../../src/services/llm');

const ORIG = {
  chat: llm.chat,
  chatJson: llm.chatJson,
};

function stubChat(fn) { llm.chat = fn; }
function stubChatJson(fn) { llm.chatJson = fn; }

function restoreAll() {
  llm.chat = ORIG.chat;
  llm.chatJson = ORIG.chatJson;
}

module.exports = { stubChat, stubChatJson, restoreAll, ORIG };
```

## 四、测试改法

### service-matchService.test.js

顶部加：
```js
const { stubChatJson, restoreAll } = require('./helpers/llm');

test.beforeEach(() => {
  restoreAll();
});
```

替换每个 `llm.chatJson = async () => {...}; ... llm.chatJson = orig;` 模式为：
```js
stubChatJson(async () => ({...}));
```

Test 1 强化：
```js
test('match returns empty when no candidates', async () => {
  await pool.query("DELETE FROM matches WHERE user_id = ?", [TEST_USER]);
  await redis.del(`match:batch:${TEST_USER}:1`);
  // 兜底清 seed data
  await pool.query("DELETE FROM jobs WHERE source = 'seed'");
  // 防御
  stubChatJson(async () => ({ parsed: { results: [] }, usage: {} }));
  
  const resumeId = await insertResume('');
  const result = await matchService.match(TEST_USER, resumeId);
  assert.deepEqual(result.results, []);
  await pool.query('DELETE FROM resumes WHERE id = ?', [resumeId]);
});
```

### route-resume-generate-llm.test.js

顶部：
```js
const { stubChat, restoreAll } = require('./helpers/llm');

test.beforeEach(() => {
  restoreAll();
});
```

逐个 test 替换手动 orig/restore 模式为 `stubChat(...)`。

## 五、验证

```bash
cd backend
node --test --test-force-exit tests/service-matchService.test.js
node --test --test-force-exit tests/route-resume-generate-llm.test.js

# 3-5x 全量
for i in 1 2 3 4 5; do
  echo "--- run $i ---"
  npm test 2>&1 | grep -E "^ℹ (pass|fail|tests)"
done
```

期望：5 runs 全 ≥ 110/111，0 fail。

## 六、风险

| 风险 | 缓解 |
|------|------|
| ORIG 捕获时机错 | llm.js module load 立即完成，chat/chatJson 函数引用 OK |
| beforeEach 在 stub 之前 | 顺序：beforeEach → test body → beforeEach；安全 |
| 跨测试文件污染 | helper ORIG 是 module-load 时捕获，跨文件不重置；但每个文件 beforeEach 都调 restoreAll |

## 七、执行清单

- [ ] T1: 新建 `tests/helpers/llm.js`
- [ ] T2: `service-matchService.test.js` 改 helper
- [ ] T3: `route-resume-generate-llm.test.js` 改 helper
- [ ] T4: 3-5x 验收全 110+/111
- [ ] 提交 + push + devlog
