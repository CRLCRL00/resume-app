/**
 * parseLlmJson 单元测试 (无 DB 依赖)
 *
 * 验证 LLM 输出 JSON 解析的 4 种 fallback:
 *   1. 标准 JSON → structured
 *   2. 包 ```json ... ``` 包裹 → structured
 *   3. 多余前后缀 → structured
 *   4. 纯文本 / 垃圾 → plaintext
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLlmJson, normalize } = require('../src/utils/parseLlmJson');

// ==================== 标准 JSON ====================

test('structured: standard JSON object', () => {
  const r = parseLlmJson('{"resume": "# Hi", "storyPoints": [{"title": "T1"}]}');
  assert.equal(r.mode, 'structured');
  assert.equal(r.data.resume, '# Hi');
  assert.equal(r.data.storyPoints.length, 1);
  assert.equal(r.data.storyPoints[0].title, 'T1');
});

test('structured: JSON with whitespace', () => {
  const r = parseLlmJson('  \n  {"resume": "x", "storyPoints": []}  \n  ');
  assert.equal(r.mode, 'structured');
  assert.equal(r.data.resume, 'x');
});

// ==================== ```json``` 包裹 ====================

test('structured: ```json ... ``` wrapper', () => {
  const r = parseLlmJson('```json\n{"resume": "wrapped", "storyPoints": [{"title": "T"}]}\n```');
  assert.equal(r.mode, 'structured');
  assert.equal(r.data.resume, 'wrapped');
  assert.equal(r.data.storyPoints.length, 1);
});

test('structured: ``` (no language) wrapper', () => {
  const r = parseLlmJson('```\n{"resume": "no-lang", "storyPoints": []}\n```');
  assert.equal(r.mode, 'structured');
  assert.equal(r.data.resume, 'no-lang');
});

// ==================== 多余前后缀 ====================

test('structured: prefix text + JSON + suffix text', () => {
  const r = parseLlmJson('这是说明\n\n{"resume": "middle", "storyPoints": []}\n\n后缀');
  assert.equal(r.mode, 'structured');
  assert.equal(r.data.resume, 'middle');
});

test('structured: prefix inside ``` code fence then JSON', () => {
  const r = parseLlmJson('代码示例: ```js\nconst x = 1\n```\n\n{"resume": "after-code", "storyPoints": []}');
  assert.equal(r.mode, 'structured');
  assert.equal(r.data.resume, 'after-code');
});

// ==================== Plaintext fallback ====================

test('plaintext: pure Chinese text', () => {
  const r = parseLlmJson('这是一份普通文本简历,没有任何 JSON');
  assert.equal(r.mode, 'plaintext');
  assert.match(r.data.resume, /普通文本简历/);
  assert.deepEqual(r.data.storyPoints, []);
});

test('plaintext: empty string', () => {
  const r = parseLlmJson('');
  assert.equal(r.mode, 'plaintext');
  assert.equal(r.data.resume, '');
});

test('plaintext: whitespace only', () => {
  const r = parseLlmJson('   \n\t  ');
  assert.equal(r.mode, 'plaintext');
  assert.equal(r.data.resume, '   \n\t  '); // 保留原文
});

test('plaintext: invalid JSON garbage', () => {
  const r = parseLlmJson('{not valid json at all');
  assert.equal(r.mode, 'plaintext');
  assert.match(r.data.resume, /not valid json/);
});

// ==================== normalize 行为 ====================

test('normalize: missing storyPoints → empty array', () => {
  const r = parseLlmJson('{"resume": "only resume"}');
  assert.deepEqual(r.data.storyPoints, []);
});

test('normalize: missing resume → empty string', () => {
  const r = parseLlmJson('{"storyPoints": [{"title": "T"}]}');
  assert.equal(r.data.resume, '');
  assert.equal(r.data.storyPoints.length, 1);
});

test('normalize: storyPoints 不是数组 → fallback 到空数组', () => {
  const r = parseLlmJson('{"resume": "x", "storyPoints": "not array"}');
  assert.deepEqual(r.data.storyPoints, []);
});

test('normalize: resume 不是字符串 → fallback 到空', () => {
  const r = parseLlmJson('{"resume": 123, "storyPoints": []}');
  assert.equal(r.data.resume, '');
});

test('normalize: null 对象 → 空', () => {
  const r = parseLlmJson('null');
  // null 会被 JSON.parse 成功 (返回 null),然后 normalize 检测 typeof === 'object' 但 === null
  // 返回 {resume: '', storyPoints: []},mode 是 plaintext (因为不是 object with resume field)
  // 实际: parseLlmJson 把 null 当 plaintext 处理
  assert.equal(r.mode, 'plaintext');
});

test('normalize: empty object {} → 都空', () => {
  const r = parseLlmJson('{}');
  assert.equal(r.mode, 'structured');
  assert.equal(r.data.resume, '');
  assert.deepEqual(r.data.storyPoints, []);
});

// ==================== 边界 ====================

test('throws on non-string input', () => {
  assert.throws(() => parseLlmJson(null), TypeError);
  assert.throws(() => parseLlmJson(undefined), TypeError);
  assert.throws(() => parseLlmJson(123), TypeError);
  assert.throws(() => parseLlmJson({}), TypeError);
});

test('preserve exported normalize function for direct use', () => {
  const n = normalize({ resume: 'r', storyPoints: [{ title: 't' }] });
  assert.equal(n.resume, 'r');
  assert.equal(n.storyPoints[0].title, 't');
});

// ==================== 实际生产场景模拟 ====================

test('e2e-like: 模拟 resumeGenerator 真实输入', () => {
  // 模拟 LLM 返回完整 resume + 3 个 STAR
  const llmOutput = JSON.stringify({
    resume: '# 张三\n## 工作\n2020-2024 字节跳动',
    storyPoints: [
      {
        title: '简历推荐小程序',
        situation: '需要 LLM 生成简历',
        task: '集成 DeepSeek',
        action: '用 Claude/DeepSeek 协作完成',
        result: '114 单测全绿,公网上线',
      },
      {
        title: 'AIGC 平台',
        situation: '需用户系统 + AI 生成',
        task: '搭 NestJS + Vue3',
        action: 'AI 协作开发',
        result: 'Phase 0 完成 8/9',
      },
      {
        title: 'bug 修复',
        situation: '用户打不进字',
        task: '排查 input/focus',
        action: 'review 3 个 critical bug',
        result: '114 + 16 测试全绿',
      },
    ],
  });

  const r = parseLlmJson(llmOutput);
  assert.equal(r.mode, 'structured');
  assert.equal(r.data.storyPoints.length, 3);
  // 验证 STAR 结构
  for (const sp of r.data.storyPoints) {
    assert.ok(sp.title);
    assert.ok(sp.situation);
    assert.ok(sp.task);
    assert.ok(sp.action);
    assert.ok(sp.result);
  }
});

test('e2e-like: 模拟 LLM 返回 markdown 包裹 JSON', () => {
  const llmOutput = `好的,这是简历:

\`\`\`json
{
  "resume": "# 张三 简历",
  "storyPoints": [{"title": "T", "situation": "S", "task": "T", "action": "A", "result": "R"}]
}
\`\`\`

如有需要请告诉我。`;

  const r = parseLlmJson(llmOutput);
  assert.equal(r.mode, 'structured');
  assert.equal(r.data.resume, '# 张三 简历');
  assert.equal(r.data.storyPoints.length, 1);
});