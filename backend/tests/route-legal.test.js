const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

test('GET /api/legal/privacy returns content', async () => {
  const res = await request(createApp()).get('/api/legal/privacy');
  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.match(res.body.data.title, /隐私/);
  assert.ok(res.body.data.content.length > 200);
  assert.ok(res.body.data.updated_at);
});

test('GET /api/legal/terms returns content', async () => {
  const res = await request(createApp()).get('/api/legal/terms');
  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.match(res.body.data.title, /服务/);
  assert.ok(res.body.data.content.length > 200);
});

test('GET /api/legal/privacy mentions DeepSeek', async () => {
  // 审核需要明确告知第三方
  const res = await request(createApp()).get('/api/legal/privacy');
  assert.match(res.body.data.content, /DeepSeek/);
});

test.after(async () => {
  // legal 路由不需要 db/redis
});
