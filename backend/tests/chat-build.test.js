/**
 * R-JobPilot-v2: 对话建简历路由 + service 集成测试
 *
 * 覆盖:
 *   POST /api/jobpilot/v1/chat-build/start    创建会话 + 第一问
 *   POST /api/jobpilot/v1/chat-build/next     接收回答 + 下一问
 *   POST /api/jobpilot/v1/chat-build/complete 完成 + 输出简历 JSON
 *
 * Mock LLM: 用 require.cache 替换 llm 模块 (避免真实 DeepSeek API 调用)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const express = require('express');
const { getPool, cleanup } = require('./helpers/db');
const pool = getPool();
const { mockUserAuth } = require('./helpers/mockAuth');

const TEST_USER_ID = 123;  // 跟 mockUserAuth.js 的 userId 一致
const TEST_OPENID = 'chat_build_test_user';

// ============== Mock LLM ==============
const llmPath = require.resolve('../src/services/llm');
const originalLlm = require.cache[llmPath];

function installMockLlm(responses = []) {
  let idx = 0;
  require.cache[llmPath] = {
    exports: {
      chat: async () => ({
        content: responses[idx++] || JSON.stringify({
          nextQuestion: 'mock next question',
          hint: 'mock hint',
          isComplete: false,
          extractedFields: {},
          nextFieldId: 'skills',
        }),
      }),
    },
  };
}

function restoreLlm() {
  if (originalLlm) require.cache[llmPath] = originalLlm;
  else delete require.cache[llmPath];
}

// ============== Helper: 构造带 mock auth 的 mini-app ==============
function buildAppWithMockAuth(routerPath, router) {
  const app = express();
  app.use(express.json());
  app.use(mockUserAuth);
  app.use(routerPath, router);
  return app;
}

// 顶层 mount: /api/jobpilot → jobpilot.js (含 v1 子路由 mount)
const jobpilotRouter = require('../src/routes/jobpilot');
// chatBuild factory (用 mockUserAuth 替代真实 userAuth, 避免 mock token.verify)
const { makeChatBuildRouter } = require('../src/routes/chatBuild');
const chatBuildRouterForTest = makeChatBuildRouter({ userAuthMiddleware: mockUserAuth });
// 替换 jobpilot.js 内部的 chatBuild 引用, 让测试 app 用 mock auth 版
// (通过挂载在 jobpilotV1 子路径下覆盖)
const jobpilotV1RouterForTest = require('express').Router();
jobpilotV1RouterForTest.use('/chat-build', chatBuildRouterForTest);

// ============== 测试数据 setup/teardown ==============

test.before(async () => {
  // 准备 users 表 (跟 mockUserAuth 一致)
  await pool.query("DELETE FROM users WHERE openid = ?", [TEST_OPENID]);
  await pool.query(
    "INSERT INTO users (id, openid) VALUES (?, ?) ON DUPLICATE KEY UPDATE id = ?",
    [TEST_USER_ID, TEST_OPENID, TEST_USER_ID]
  );
  // 清理该用户的所有 chat_build_sessions
  await pool.query('DELETE FROM chat_build_sessions WHERE user_id = ?', [TEST_USER_ID]);
});

test.after(async () => {
  await pool.query('DELETE FROM chat_build_sessions WHERE user_id = ?', [TEST_USER_ID]);
  await pool.query("DELETE FROM users WHERE openid = ?", [TEST_OPENID]);
  restoreLlm();
  await cleanup();
});

// ============== POST /api/jobpilot/v1/chat-build/start ==============

test('POST start: 缺少 image 返回 400', async () => {
  const app = buildAppWithMockAuth('/api/jobpilot/v1/chat-build', chatBuildRouterForTest);
  const res = await request(app).post('/api/jobpilot/v1/chat-build/start').send({});
  assert.equal(res.status, 400);
});

test('POST start: 未知 image 返回 400', async () => {
  installMockLlm(['{"nextQuestion":"Q","hint":"H","isComplete":false}']);
  const app = buildAppWithMockAuth('/api/jobpilot/v1/chat-build', chatBuildRouterForTest);
  const res = await request(app)
    .post('/api/jobpilot/v1/chat-build/start')
    .send({ image: 'unknown_image_xyz', answers: {} });
  assert.equal(res.status, 400);
});

test('POST start: 4 种画像都能正常 start + 写库', async () => {
  const images = [
    'ai_collaboration_project_lead',
    'traditional_cs_fresh',
    'career_transition',
    'algorithm_research',
  ];
  for (const image of images) {
    installMockLlm([`{"nextQuestion":"Q for ${image}","hint":"H","isComplete":false,"nextFieldId":"skills"}`]);
    const app = buildAppWithMockAuth('/api/jobpilot/v1/chat-build', chatBuildRouterForTest);
    const res = await request(app)
      .post('/api/jobpilot/v1/chat-build/start')
      .send({
        image,
        answers: { education: '大专', aiAbility: 'AI 协作', projects: '简历 app', target: '实习', timeline: '立刻' },
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.sessionId, `sessionId exists for ${image}`);
    assert.equal(res.body.image, image);
    assert.ok(res.body.recommendedRounds >= 5);
    assert.ok(Array.isArray(res.body.priorityFields));
    assert.ok(res.body.firstQuestion);

    // 验证数据库
    const [rows] = await pool.query(
      'SELECT id, image, recommended_rounds, status FROM chat_build_sessions WHERE id = ?',
      [res.body.sessionId]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].image, image);
    assert.equal(rows[0].status, 'active');
  }
});

test('POST start: image 必填 (空字符串 400)', async () => {
  const app = buildAppWithMockAuth('/api/jobpilot/v1/chat-build', chatBuildRouterForTest);
  const res = await request(app)
    .post('/api/jobpilot/v1/chat-build/start')
    .send({ image: '', answers: {} });
  assert.equal(res.status, 400);
});

// ============== POST /api/jobpilot/v1/chat-build/next ==============

test('POST next: 缺少 sessionId 返回 400', async () => {
  const app = buildAppWithMockAuth('/api/jobpilot/v1/chat-build', chatBuildRouterForTest);
  const res = await request(app)
    .post('/api/jobpilot/v1/chat-build/next')
    .send({ userAnswer: 'test' });
  assert.equal(res.status, 400);
});

test('POST next: 缺少 userAnswer 返回 400', async () => {
  const app = buildAppWithMockAuth('/api/jobpilot/v1/chat-build', chatBuildRouterForTest);
  const res = await request(app)
    .post('/api/jobpilot/v1/chat-build/next')
    .send({ sessionId: 'cb_123' });
  assert.equal(res.status, 400);
});

test('POST next: 找不到 session 返回 404', async () => {
  installMockLlm([]);
  const app = buildAppWithMockAuth('/api/jobpilot/v1/chat-build', chatBuildRouterForTest);
  const res = await request(app)
    .post('/api/jobpilot/v1/chat-build/next')
    .send({ sessionId: '99999', userAnswer: 'test' });
  assert.equal(res.status, 404);
});

test('POST next: 完整 start → next → next 流程', async () => {
  installMockLlm([
    // start 的第一问
    '{"nextQuestion":"Q1","hint":"H1","isComplete":false,"nextFieldId":"skills"}',
    // next 的下一问
    '{"nextQuestion":"Q2","hint":"H2","isComplete":false,"nextFieldId":"projects[0].name"}',
  ]);
  const app = buildAppWithMockAuth('/api/jobpilot/v1/chat-build', chatBuildRouterForTest);

  // start
  const startRes = await request(app)
    .post('/api/jobpilot/v1/chat-build/start')
    .send({ image: 'ai_collaboration_project_lead', answers: {} });
  assert.equal(startRes.status, 200);
  const sessionId = startRes.body.sessionId;

  // next (第 1 轮 → 第 2 轮)
  installMockLlm([
    '{"nextQuestion":"Q2","hint":"H2","isComplete":false,"nextFieldId":"projects[0].name"}',
  ]);
  const nextRes = await request(app)
    .post('/api/jobpilot/v1/chat-build/next')
    .send({ sessionId, userAnswer: '我用 Claude 协作' });
  assert.equal(nextRes.status, 200);
  assert.equal(nextRes.body.ok, true);
  assert.equal(nextRes.body.currentRound, 1);
  assert.equal(nextRes.body.isComplete, false);
  assert.ok(nextRes.body.nextQuestion);

  // 验证数据库 current_round 递增
  const [rows] = await pool.query(
    'SELECT current_round, current_field_id FROM chat_build_sessions WHERE id = ?',
    [sessionId]
  );
  assert.equal(rows[0].current_round, 1);
});

// ============== POST /api/jobpilot/v1/chat-build/complete ==============

test('POST complete: 强制完成 + 输出简历 JSON + STAR 故事点', async () => {
  installMockLlm([
    '{"nextQuestion":"Q1","hint":"H1","isComplete":false,"nextFieldId":"name"}',
  ]);
  const app = buildAppWithMockAuth('/api/jobpilot/v1/chat-build', chatBuildRouterForTest);

  // start
  const startRes = await request(app)
    .post('/api/jobpilot/v1/chat-build/start')
    .send({ image: 'ai_collaboration_project_lead', answers: {} });
  const sessionId = startRes.body.sessionId;

  // 验证 mock LLM 生效: nextFieldId 应为 'name' (而不是 fallback 的 projects[0].name)
  assert.equal(startRes.body.currentFieldId, 'name', 'mock LLM should set currentFieldId=name');

  // next 一次 (填 name 字段)
  installMockLlm([
    '{"nextQuestion":"Q2","hint":"H2","isComplete":false,"nextFieldId":"phone"}',
  ]);
  await request(app)
    .post('/api/jobpilot/v1/chat-build/next')
    .send({ sessionId, userAnswer: '张三' });

  // R-JobPilot-v2 W2 T3: complete 调 resumeGenerator 拿 STAR 故事点
  // mock LLM 返 {resume, storyPoints} JSON
  installMockLlm([
    JSON.stringify({
      resume: '# 张三\n## 工作经历\n...',
      storyPoints: [
        { title: 'AI 协作开发', situation: '需要快速产出生产级 AI 应用', task: '通过 Claude 协作完成代码 + 我做 review', action: '设计 Prompt 模板 + review + 测试 + 部署', result: '114 单测全绿 + 公网可访问' },
      ],
    }),
  ]);
  const completeRes = await request(app)
    .post('/api/jobpilot/v1/chat-build/complete')
    .send({ sessionId });
  assert.equal(completeRes.status, 200);
  assert.equal(completeRes.body.ok, true);
  assert.equal(completeRes.body.status, 'completed');
  assert.ok(completeRes.body.resumeJson);
  assert.equal(completeRes.body.resumeJson.name, '张三', 'assembleResume should map name 字段');
  assert.equal(completeRes.body.nextStep, 'project_score');
  // W2 T3: 联调产出 STAR
  assert.ok(Array.isArray(completeRes.body.storyPoints), 'storyPoints 应为数组');
  assert.ok(completeRes.body.storyPoints.length >= 1, 'resumeGenerator 应产出至少 1 个 storyPoint');
  assert.equal(completeRes.body.storyPoints[0].title, 'AI 协作开发');

  // 验证数据库 status + completed_at
  const [rows] = await pool.query(
    'SELECT status, completed_at, result FROM chat_build_sessions WHERE id = ?',
    [sessionId]
  );
  assert.equal(rows[0].status, 'completed');
  assert.ok(rows[0].completed_at);
});

test('POST complete: 缺少 sessionId 返回 400', async () => {
  const app = buildAppWithMockAuth('/api/jobpilot/v1/chat-build', chatBuildRouterForTest);
  const res = await request(app).post('/api/jobpilot/v1/chat-build/complete').send({});
  assert.equal(res.status, 400);
});

// ============== service 单元测试 (直接调 service, 传 stub llm) ==============

test('chatBuildService.assembleResume: 字段正确映射到简历 JSON', async () => {
  const { _assembleResume } = require('../src/services/chatBuildService');
  const answeredFields = [
    { fieldId: 'name', answer: '张三' },
    { fieldId: 'phone', answer: '13800000000' },
    { fieldId: 'skills', answer: 'Python, DeepSeek, Coze' },
    { fieldId: 'projects[0].name', answer: '简历 app' },
    { fieldId: 'projects[0].aiCollaboration', answer: '用 Claude 协作' },
    { fieldId: 'projects[0].result', answer: '114 单测' },
  ];
  const out = _assembleResume(answeredFields);
  assert.equal(out.name, '张三');
  assert.equal(out.phone, '13800000000');
  assert.deepEqual(out.skills, ['Python', 'DeepSeek', 'Coze']);
  assert.equal(out.projects[0].name, '简历 app');
  assert.equal(out.projects[0].aiCollaboration, '用 Claude 协作');
  assert.equal(out.projects[0].result, '114 单测');
});

test('chatBuildService._safeParse: 解析 markdown 包裹的 JSON', async () => {
  const { _safeParse } = require('../src/services/chatBuildService');
  const out = _safeParse('```json\n{"nextQuestion":"Q","hint":"H"}\n```');
  assert.deepEqual(out, { nextQuestion: 'Q', hint: 'H' });

  const out2 = _safeParse('{"a":1}');
  assert.deepEqual(out2, { a: 1 });

  const out3 = _safeParse('not json');
  assert.equal(out3, null);

  const out4 = _safeParse(null);
  assert.equal(out4, null);
});

// ============== R-JobPilot-v2 W2 T2: 追问深度规则引擎 ==============

test('chatBuildPrompt.analyzeUserAnswer: 触发标志识别', () => {
  const { analyzeUserAnswer } = require('../src/services/chatBuildPrompt');

  // 太短
  const t1 = analyzeUserAnswer('好');
  assert.equal(t1.tooShort, true);
  assert.equal(t1.hasNumber, false);

  // 有数字 (30% / 5倍 / 100万)
  assert.equal(analyzeUserAnswer('提升了 30%').hasNumber, true);
  assert.equal(analyzeUserAnswer('用户涨了 5 倍').hasNumber, true);
  assert.equal(analyzeUserAnswer('100 万用户').hasNumber, true);

  // AI 工具
  assert.equal(analyzeUserAnswer('用 Claude 协作').hasAITool, true);
  assert.equal(analyzeUserAnswer('DeepSeek 生成').hasAITool, true);
  assert.equal(analyzeUserAnswer('Coze 搭了个 agent').hasAITool, true);

  // 模糊
  assert.equal(analyzeUserAnswer('大概是这样').isVague, true);
  assert.equal(analyzeUserAnswer('可能行吧').isVague, true);

  // 不知道
  assert.equal(analyzeUserAnswer('不知道').isUnknown, true);
  assert.equal(analyzeUserAnswer('不清楚').isUnknown, true);
});

test('chatBuildPrompt.pickNextField: 4 种画像推荐字段', () => {
  const { pickNextField, IMAGE_STRATEGY } = require('../src/services/chatBuildPrompt');

  // AI 协作画像 + 无 trigger: 按 priorityFields[0]
  const f1 = pickNextField('ai_collaboration_project_lead', [], {});
  assert.equal(f1, IMAGE_STRATEGY.ai_collaboration_project_lead.priorityFields[0]);

  // hasNumber 触发: 跳到 .result 字段
  const f2 = pickNextField(
    'ai_collaboration_project_lead',
    [{ fieldId: 'projects[0].aiCollaboration' }],  // 已答一个
    { hasNumber: true }
  );
  assert.ok(f2 && f2.endsWith('.result'), `expected .result field, got ${f2}`);

  // hasAITool 触发: 跳到 aiCollaboration 字段
  const f3 = pickNextField(
    'ai_collaboration_project_lead',
    [],
    { hasAITool: true }
  );
  assert.ok(f3 && f3.includes('aiCollaboration'), `expected aiCollaboration, got ${f3}`);

  // 全部填完: 返 null
  const allAnswered = IMAGE_STRATEGY.ai_collaboration_project_lead.priorityFields.map(
    (f) => ({ fieldId: f })
  );
  assert.equal(pickNextField('ai_collaboration_project_lead', allAnswered, {}), null);

  // 未知 image: 返 null
  assert.equal(pickNextField('unknown_image', [], {}), null);
});