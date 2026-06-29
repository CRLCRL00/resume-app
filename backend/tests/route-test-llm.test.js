const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { chat } = require('../src/services/llm');
const { cleanup } = require('./helpers/db');

test('GET /api/test/llm returns ok with token info', async () => {
  const orig = chat;
  require('../src/services/llm').chat = async () => ({
    content: 'pong',
    usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
  });

  const res = await request(createApp()).get('/api/test/llm');
  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.equal(res.body.data.reply, 'pong');
  assert.equal(res.body.data.usage.total_tokens, 6);

  require('../src/services/llm').chat = orig;
});

test.after(async () => {
  await cleanup();
});
