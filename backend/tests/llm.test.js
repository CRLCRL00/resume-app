const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chat, chatJson } = require('../src/services/llm');

test('chat returns content from deepseek', async () => {
  const axios = require('axios');
  const orig = axios.post;
  axios.post = async (url, body) => {
    if (url.includes('/chat/completions')) {
      return {
        data: {
          choices: [{ message: { content: 'mock reply' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      };
    }
    return orig(url, body);
  };

  const result = await chat([{ role: 'user', content: 'hi' }]);
  assert.equal(result.content, 'mock reply');
  assert.equal(result.usage.total_tokens, 15);

  axios.post = orig;
});

test('chatJson parses JSON response', async () => {
  const axios = require('axios');
  const orig = axios.post;
  axios.post = async () => ({
    data: {
      choices: [{ message: { content: '{"score":85,"reason":"good"}' } }],
      usage: { total_tokens: 20 },
    },
  });

  const result = await chatJson([{ role: 'user', content: 'x' }]);
  assert.equal(result.parsed.score, 85);
  assert.equal(result.parsed.reason, 'good');

  axios.post = orig;
});

test('chatJson strips markdown code fences', async () => {
  const axios = require('axios');
  const orig = axios.post;
  axios.post = async () => ({
    data: {
      choices: [{ message: { content: '```json\n{"a":1}\n```' } }],
      usage: { total_tokens: 5 },
    },
  });

  const result = await chatJson([{ role: 'user', content: 'x' }]);
  assert.equal(result.parsed.a, 1);

  axios.post = orig;
});