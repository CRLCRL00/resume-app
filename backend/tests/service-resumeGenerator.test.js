const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generate } = require('../src/services/resumeGenerator');
const { chat } = require('../src/services/llm');

test('generate calls llm.chat with system+user and trims', async () => {
  const orig = chat;
  let captured;
  require('../src/services/llm').chat = async (messages, opts) => {
    captured = { messages, opts };
    return { content: '  # 真生成\n## 内容\n', usage: {} };
  };

  const result = await generate({ name: '张三' });

  assert.equal(result, '# 真生成\n## 内容');
  assert.equal(captured.messages.length, 2);
  assert.equal(captured.messages[0].role, 'system');
  assert.equal(captured.messages[1].role, 'user');
  assert.match(captured.messages[1].content, /张三/);
  assert.equal(captured.opts.maxTokens, 1500);
  assert.equal(captured.opts.temperature, 0.7);

  require('../src/services/llm').chat = orig;
});

test('generate propagates llm errors', async () => {
  const orig = chat;
  require('../src/services/llm').chat = async () => {
    const { AppError } = require('../src/middleware/errorHandler');
    throw new AppError(1100, 'llm timeout', 502);
  };

  await assert.rejects(generate({ name: 'x' }), /llm timeout/);
  require('../src/services/llm').chat = orig;
});

test('generate uses full prompt as system (no duplicate)', async () => {
  const orig = chat;
  let captured;
  require('../src/services/llm').chat = async (m) => {
    captured = m;
    return { content: 'ok', usage: {} };
  };

  await generate({ name: 'test' });
  // system should contain the role from prompts table (default seed)
  assert.ok(captured[0].content.includes('HR'));
  // user should be JSON only
  assert.match(captured[1].content, /^\{[\s\S]*\}$/);

  require('../src/services/llm').chat = orig;
});