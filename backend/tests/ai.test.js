// R114 T1: AI assist-field route
// - POST /api/ai/assist-field with deepseek LLM
// - joi validation (400 on missing fieldId)
// - opens {opening, followups[], suggestion}
// - upstream LLM failure → 502
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { sign } = require('../src/services/token');
const { stubChatJson, restoreAll } = require('./helpers/llm');
const { AppError } = require('../src/middleware/errorHandler');

test('POST /api/ai/assist-field returns 401 when no token', async () => {
  const res = await request(createApp())
    .post('/api/ai/assist-field')
    .send({ fieldId: 'name', fieldLabel: '姓名', currentValue: '张三' });
  assert.equal(res.status, 401);
});

test('POST /api/ai/assist-field returns 400 when fieldId missing', async () => {
  const token = sign({ userId: 2, openid: 'o-ai-test' });
  const res = await request(createApp())
    .post('/api/ai/assist-field')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentValue: '张三' });
  assert.equal(res.status, 400);
});

test('POST /api/ai/assist-field returns 400 when history exceeds 20 items', async () => {
  const token = sign({ userId: 2, openid: 'o-ai-test' });
  const history = Array.from({ length: 21 }, () => ({ role: 'user', content: 'hi' }));
  const res = await request(createApp())
    .post('/api/ai/assist-field')
    .set('Authorization', `Bearer ${token}`)
    .send({ fieldId: 'name', fieldLabel: '姓名', currentValue: '张三', history });
  assert.equal(res.status, 400);
});

test('POST /api/ai/assist-field returns 400 when currentValue exceeds 2000 chars', async () => {
  const token = sign({ userId: 2, openid: 'o-ai-test' });
  const res = await request(createApp())
    .post('/api/ai/assist-field')
    .set('Authorization', `Bearer ${token}`)
    .send({ fieldId: 'name', fieldLabel: '姓名', currentValue: 'x'.repeat(2001) });
  assert.equal(res.status, 400);
});

test('POST /api/ai/assist-field returns opening + followups + suggestion for valid input', async () => {
  const token = sign({ userId: 2, openid: 'o-ai-test' });
  stubChatJson(async () => ({
    parsed: {
      opening: '嗨, 张三 同学!',
      followups: ['能告诉我你的手机号吗?'],
      suggestion: '姓名已填写',
    },
    usage: { total_tokens: 100 },
  }));
  try {
    const res = await request(createApp())
      .post('/api/ai/assist-field')
      .set('Authorization', `Bearer ${token}`)
      .send({ fieldId: 'name', fieldLabel: '姓名', currentValue: '张三' });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.ok(res.body.data.opening.includes('张三'), 'opening 应包含用户姓名');
    assert.ok(Array.isArray(res.body.data.followups), 'followups 应为数组');
    assert.ok(res.body.data.followups.length >= 1 && res.body.data.followups.length <= 3, 'followups 长度应为 1-3');
    assert.ok(res.body.data.suggestion, 'suggestion 应有内容');
  } finally {
    restoreAll();
  }
});

test('POST /api/ai/assist-field returns 502 when LLM upstream fails', async () => {
  const token = sign({ userId: 2, openid: 'o-ai-test' });
  stubChatJson(async () => {
    throw new AppError(1100, 'llm upstream unavailable', 502);
  });
  try {
    const res = await request(createApp())
      .post('/api/ai/assist-field')
      .set('Authorization', `Bearer ${token}`)
      .send({ fieldId: 'name', fieldLabel: '姓名', currentValue: '张三' });
    assert.equal(res.status, 502);
  } finally {
    restoreAll();
  }
});

// ─── R115 T1: Wizard 模式 (AI 主动提问) ─────────────
test('POST /api/ai/assist-field mode=wizard returns nextQuestion + hint + isComplete for valid input', async () => {
  const token = sign({ userId: 2, openid: 'o-ai-test' });
  stubChatJson(async () => ({
    parsed: {
      nextQuestion: '嗨, 怎么称呼你?',
      hint: '中英文都行',
      isComplete: false,
    },
  }));
  try {
    const res = await request(createApp())
      .post('/api/ai/assist-field')
      .set('Authorization', `Bearer ${token}`)
      .send({
        mode: 'wizard',
        fieldId: 'name',
        fieldLabel: '姓名',
        currentValue: '',
        answeredFields: [],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.ok(res.body.data.nextQuestion);
    assert.ok(res.body.data.hint);
    assert.equal(res.body.data.isComplete, false);
  } finally {
    restoreAll();
  }
});

test('POST /api/ai/assist-field mode=wizard returns recommendations (3 items with value + reason)', async () => {
  const token = sign({ userId: 2, openid: 'o-ai-test' });
  stubChatJson(async () => ({
    parsed: {
      nextQuestion: '你可能想做哪类工作?',
      hint: '选最接近的',
      isComplete: false,
      recommendations: [
        { value: '前端工程师', reason: '需求大' },
        { value: '后端工程师', reason: '稳定' },
        { value: '全栈工程师', reason: '选择多' },
      ],
    },
    usage: { total_tokens: 100 },
  }));
  try {
    const res = await request(createApp())
      .post('/api/ai/assist-field')
      .set('Authorization', `Bearer ${token}`)
      .send({
        mode: 'wizard',
        fieldId: 'work_title',
        fieldLabel: '职位',
        currentValue: '',
        answeredFields: [],
      });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.recommendations, 'R117: 必有 recommendations 字段');
    assert.equal(res.body.data.recommendations.length, 3, 'R117: 3 个推荐');
    assert.equal(res.body.data.recommendations[0].value, '前端工程师');
    assert.equal(res.body.data.recommendations[0].reason, '需求大');
  } finally {
    restoreAll();
  }
});

test('POST /api/ai/assist-field mode=wizard returns 502 when LLM upstream fails', async () => {
  const token = sign({ userId: 2, openid: 'o-ai-test' });
  stubChatJson(async () => {
    throw new AppError(1100, 'llm upstream unavailable', 502);
  });
  try {
    const res = await request(createApp())
      .post('/api/ai/assist-field')
      .set('Authorization', `Bearer ${token}`)
      .send({
        mode: 'wizard',
        fieldId: 'name',
        fieldLabel: '姓名',
        currentValue: '',
        answeredFields: [],
      });
    assert.equal(res.status, 502);
  } finally {
    restoreAll();
  }
});

test('POST /api/ai/assist-field mode=wizard returns 400 when answeredFields malformed', async () => {
  const token = sign({ userId: 2, openid: 'o-ai-test' });
  const res = await request(createApp())
    .post('/api/ai/assist-field')
    .set('Authorization', `Bearer ${token}`)
    .send({
      mode: 'wizard',
      fieldId: 'name',
      fieldLabel: '姓名',
      currentValue: '',
      answeredFields: 'not-an-array',
    });
  assert.equal(res.status, 400);
});
