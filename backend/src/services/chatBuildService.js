/**
 * R-JobPilot-v2: 对话建简历 service (Step 2.5)
 *
 * 核心功能:
 *   - start: 创建会话 + 调 LLM 拿第一问
 *   - next: 接收用户回答 + 调 LLM 拿下一问 (基于画像动态追问)
 *   - complete: 必填字段已填 → 输出简历 JSON (后续触发 Step 2 项目评分 + Step 4 简历生成)
 *
 * 设计:
 *   - 对话历史存 chat_build_sessions 表 (支持中断恢复)
 *   - Prompt 通过 chatBuildPrompt.build() 加载 (基于画像动态变量)
 *   - LLM 调用通过 llm.chat() (复用现有 DeepSeek 集成)
 *   - 完整 LLM 调用规则在 Week 2 完善; Week 1 先把骨架跑通 (Prompt 缺失时 fallback hardcoded)
 *
 * 引用约定:
 *   llm 模块通过参数注入 (default require('../services/llm'))
 *   方便测试 mock
 */

'use strict';

const pool = require('../config/db');
const { AppError } = require('../middleware/errorHandler');
const chatBuildPrompt = require('./chatBuildPrompt');
const logger = require('../utils/logger');

// 不在 module-level require llm, 改为函数内 require (让测试 mock require.cache 生效)
function getDefaultLlm() { return require('./llm'); }

/**
 * Week 1 fallback: Prompt 未配置时给个硬编码的第一问 (保证 service 可用)
 * Week 2 在 prompts 表 seed chat_build_next_question 后会走真实 LLM
 */
const FALLBACK_FIRST_QUESTION = {
  nextQuestion: '你好! 我是你的 AI 简历面试官。跟我聊聊, 我们一起生成一份简历吧。你最有成就感的项目是什么?',
  hint: '项目名 + 你做了什么 + 结果',
  isComplete: false,
  extractedFields: {},
  nextFieldId: 'projects[0].name',
};

/**
 * start - 创建对话会话 + 调 LLM 拿第一问
 *
 * @param {Object} params
 * @param {number} params.userId - 用户 ID
 * @param {string} params.image - 画像分类 (from diagnoseProfile)
 * @param {Object} params.answers - 5 题答案
 * @param {Object} [params.llm] - LLM 模块 (测试用, 默认 require('./llm'))
 * @returns {Promise<{sessionId: string, image: string, recommendedRounds: number, priorityFields: Array, firstQuestion: string, hint: string, currentFieldId: string}>}
 */
async function start({ userId, image, answers = {}, llm }) {
  const llmToUse = llm || getDefaultLlm();
  if (!userId) throw new AppError(1000, 'userId required', 400);
  if (!image) throw new AppError(1000, 'image required', 400);

  const strategy = chatBuildPrompt.IMAGE_STRATEGY[image];
  if (!strategy) throw new AppError(1000, `unknown image: ${image}`, 400);

  // 1) 创建 session row
  const [r] = await pool.query(
    `INSERT INTO chat_build_sessions
      (user_id, image, recommended_rounds, current_round, current_field_id, answered_fields, conversation_history, status)
     VALUES (?, ?, ?, 0, ?, JSON_ARRAY(), JSON_ARRAY(), 'active')`,
    [userId, image, strategy.recommendedRounds, strategy.priorityFields[0]]
  );
  const sessionId = String(r.insertId);

  // 2) 加载 Prompt (Week 2 seed prompts 表; 现在 fallback 不挂服务)
  let promptResult = null;
  try {
    promptResult = await chatBuildPrompt.build({
      image,
      answers,
      currentFieldId: strategy.priorityFields[0],
      currentValue: '',
      answeredFields: [],
      conversationHistory: [],
      currentRound: 0,
    });
  } catch (err) {
    logger.warn({ err: err.message, sessionId }, 'chatBuild start: prompt load failed, use hardcoded fallback');
  }

  // 3) 调 LLM 拿第一问 (prompt 缺失时跳到 fallback)
  let firstQuestion, hint, currentFieldId;
  try {
    if (promptResult) {
      const llmResp = await llmToUse.chat(
        [
          { role: 'system', content: promptResult.system },
          { role: 'user', content: '请开始第一问' },
        ],
        { maxTokens: 500, temperature: 0.7 }
      );
      const parsed = safeParse(llmResp.content) || FALLBACK_FIRST_QUESTION;
      firstQuestion = parsed.nextQuestion || FALLBACK_FIRST_QUESTION.nextQuestion;
      hint = parsed.hint || FALLBACK_FIRST_QUESTION.hint;
      currentFieldId = parsed.nextFieldId || strategy.priorityFields[0];
    } else {
      firstQuestion = FALLBACK_FIRST_QUESTION.nextQuestion;
      hint = FALLBACK_FIRST_QUESTION.hint;
      currentFieldId = FALLBACK_FIRST_QUESTION.nextFieldId;
    }
  } catch (err) {
    logger.warn({ err: err.message, sessionId }, 'chatBuild start: LLM failed, use fallback');
    firstQuestion = FALLBACK_FIRST_QUESTION.nextQuestion;
    hint = FALLBACK_FIRST_QUESTION.hint;
    currentFieldId = FALLBACK_FIRST_QUESTION.nextFieldId;
  }

  // 3) 更新 session: current_field_id + conversation_history
  const conversationHistory = [
    { role: 'assistant', content: firstQuestion, ts: new Date().toISOString() },
  ];
  await pool.query(
    `UPDATE chat_build_sessions
     SET current_field_id = ?, conversation_history = ?
     WHERE id = ?`,
    [currentFieldId, JSON.stringify(conversationHistory), sessionId]
  );

  return {
    sessionId,
    image,
    recommendedRounds: strategy.recommendedRounds,
    priorityFields: strategy.priorityFields,
    firstQuestion,
    hint,
    currentFieldId,
  };
}

/**
 * next - 接收用户回答 + 调 LLM 拿下一问
 *
 * @param {Object} params
 * @param {string} params.sessionId - 会话 ID
 * @param {string} params.userAnswer - 用户回答
 * @param {Object} [params.llm] - LLM 模块 (测试用)
 * @returns {Promise<{isComplete: boolean, nextQuestion: string, hint: string, extractedFields: Object, nextFieldId: string, currentRound: number, remainingRounds: number}>}
 */
async function next({ sessionId, userAnswer, llm }) {
  const llmToUse = llm || getDefaultLlm();
  if (!sessionId) throw new AppError(1000, 'sessionId required', 400);
  if (!userAnswer) throw new AppError(1000, 'userAnswer required', 400);

  // 1) 读 session
  const [rows] = await pool.query(
    'SELECT user_id, image, recommended_rounds, current_round, current_field_id, answered_fields, conversation_history FROM chat_build_sessions WHERE id = ? AND status = ?',
    [sessionId, 'active']
  );
  if (!rows.length) throw new AppError(404, 'session not found or not active', 404);
  const session = rows[0];

  const answeredFields = parseJSON(session.answered_fields, []);
  const conversationHistory = parseJSON(session.conversation_history, []);

  // 2) 追加用户回答
  conversationHistory.push({
    role: 'user',
    content: userAnswer,
    ts: new Date().toISOString(),
  });
  answeredFields.push({
    fieldId: session.current_field_id,
    question: conversationHistory[conversationHistory.length - 2]?.content || '',
    answer: userAnswer,
    extractedFields: {},
  });

  const newRound = session.current_round + 1;
  const isRoundLimit = newRound >= session.recommended_rounds;

  // 3) 加载 Prompt + 调 LLM 拿下一问 (prompt 缺失时静默)
  let promptResult = null;
  try {
    promptResult = await chatBuildPrompt.build({
      image: session.image,
      currentFieldId: session.current_field_id,
      currentValue: userAnswer,
      answeredFields,
      conversationHistory,
      currentRound: newRound,
    });
  } catch (err) {
    logger.warn({ err: err.message, sessionId }, 'chatBuild next: prompt load failed');
  }

  let llmResp = null;
  try {
    if (promptResult) {
      llmResp = await llmToUse.chat(
        [
          { role: 'system', content: promptResult.system },
          { role: 'user', content: userAnswer },
        ],
        { maxTokens: 500, temperature: 0.7 }
      );
    }
  } catch (err) {
    logger.warn({ err: err.message, sessionId }, 'chatBuild next: LLM failed');
    llmResp = null;
  }

  const parsed = safeParse(llmResp?.content);
  const strategy = chatBuildPrompt.IMAGE_STRATEGY[session.image];
  const remainingFields = strategy.priorityFields.filter(
    (f) => !answeredFields.some((a) => a.fieldId === f)
  );

  const isComplete = isRoundLimit || remainingFields.length === 0;
  const nextFieldId = !isComplete
    ? (parsed?.nextFieldId || remainingFields[0] || strategy.priorityFields[0])
    : null;
  const nextQuestion = parsed?.nextQuestion || (isComplete ? '(对话完成)' : '继续聊聊?');
  const hint = parsed?.hint || '';
  const extractedFields = parsed?.extractedFields || {};

  // 4) 更新 session
  conversationHistory.push({
    role: 'assistant',
    content: nextQuestion,
    ts: new Date().toISOString(),
  });

  await pool.query(
    `UPDATE chat_build_sessions
     SET current_round = ?, current_field_id = ?, answered_fields = ?, conversation_history = ?, status = ?
     WHERE id = ?`,
    [
      newRound,
      nextFieldId,
      JSON.stringify(answeredFields),
      JSON.stringify(conversationHistory),
      isComplete ? 'completed' : 'active',
      sessionId,
    ]
  );

  return {
    isComplete,
    nextQuestion,
    hint,
    extractedFields,
    nextFieldId,
    currentRound: newRound,
    remainingRounds: Math.max(0, session.recommended_rounds - newRound),
  };
}

/**
 * complete - 强制完成会话 + 输出简历 JSON
 *
 * @param {Object} params
 * @param {string} params.sessionId - 会话 ID
 * @returns {Promise<{status: string, resumeJson: Object, storyPoints: Array, nextStep: string}>}
 */
async function complete({ sessionId }) {
  if (!sessionId) throw new AppError(1000, 'sessionId required', 400);

  const [rows] = await pool.query(
    'SELECT answered_fields, status FROM chat_build_sessions WHERE id = ?',
    [sessionId]
  );
  if (!rows.length) throw new AppError(404, 'session not found', 404);
  const session = rows[0];

  const answeredFields = parseJSON(session.answered_fields, []);

  // 从 answeredFields 组装简历 JSON (跟 resumeTemplate.js 字段对齐)
  const resumeJson = assembleResume(answeredFields);

  // 标记 completed
  await pool.query(
    `UPDATE chat_build_sessions
     SET status = 'completed', completed_at = NOW(), result = ?
     WHERE id = ?`,
    [JSON.stringify(resumeJson), sessionId]
  );

  return {
    status: 'completed',
    resumeJson,
    storyPoints: [], // Week 2 调 resumeGenerator.generate 拿 STAR 故事点
    nextStep: 'project_score', // 触发 Step 2 (jobpilotAi.scoreProject)
  };
}

/**
 * 内部工具: 从 answeredFields 组装简历 JSON
 */
function assembleResume(answeredFields) {
  const out = {
    name: '',
    phone: '',
    skills: [],
    projects: [{}],
    educations: [],
    experiences: [],
    expected: {},
    certificates: [],
    publications: [],
  };

  for (const a of answeredFields) {
    const val = a.answer;
    const fid = a.fieldId;
    if (fid === 'name') out.name = val;
    else if (fid === 'phone') out.phone = val;
    else if (fid === 'skills') out.skills = val.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
    else if (fid.startsWith('projects[0].')) {
      const key = fid.replace('projects[0].', '');
      out.projects[0][key] = val;
    }
    // Week 2 再扩展 work/education/publications
  }
  return out;
}

/**
 * 内部工具: 安全解析 JSON (LLM 输出可能不规范)
 */
function safeParse(text) {
  if (!text) return null;
  try {
    // 去掉可能的 markdown ```json 包裹
    const cleaned = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(cleaned);
  } catch (_e) {
    return null;
  }
}

/**
 * 内部工具: 解析 JSON 字段 (DB 存的 JSON 列)
 */
function parseJSON(val, fallback) {
  if (val == null) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

module.exports = {
  start,
  next,
  complete,
  // 暴露内部工具方便测试
  _safeParse: safeParse,
  _assembleResume: assembleResume,
};