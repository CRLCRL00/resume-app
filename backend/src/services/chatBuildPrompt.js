/**
 * R-JobPilot-v2: 对话建简历 Prompt 加载
 *
 * 复用 resumePrompt.buildByCode 通用加载逻辑 (从 prompts 表读 code='chat_build_next_question')
 *
 * Prompt 模板变量:
 *   - image: 画像分类 (ai_collaboration_project_lead / traditional_cs_fresh / career_transition / algorithm_research)
 *   - education: 学历
 *   - aiAbility: AI 能力
 *   - projectsSummary: 项目经验摘要
 *   - target: 目标
 *   - timeline: 时间
 *   - recommendedRounds: 推荐轮数
 *   - priorityFields: 重点追问字段列表
 *   - resumeStrategy: 简历策略
 *   - fields: 简历字段清单 [{fieldId, fieldLabel, priority}]
 *   - conversationHistory: 对话历史
 *   - currentFieldId: 当前字段 ID
 *   - currentFieldLabel: 当前字段标签
 *   - currentValue: 当前值
 *   - remainingRequiredFields: 剩余必填字段
 *   - currentRound: 当前轮数
 *
 * 输出 (system message 给 LLM, user message 是 JSON 序列化)
 */

const { buildByCode } = require('./resumePrompt');
const logger = require('../utils/logger');

const PROMPT_CODE = 'chat_build_next_question';

/**
 * 4 种画像的追问策略 + 推荐轮数
 * (跟 jobpilotAi.diagnoseProfile 的 resumeStrategy 字段对齐)
 */
const IMAGE_STRATEGY = {
  ai_collaboration_project_lead: {
    recommendedRounds: 7,
    priorityFields: [
      'projects[0].aiCollaboration',
      'projects[0].result',
      'projects[0].promptStrategy',
      'skills',
      'name',
      'phone',
      'projects[0].name',
    ],
    resumeStrategy: '重点突出 AI 协作项目经验, 弱化学历, 包装"项目负责人"叙事',
  },
  traditional_cs_fresh: {
    recommendedRounds: 6,
    priorityFields: [
      'education.detail',
      'projects[0].techStack',
      'projects[0].name',
      'skills',
      'name',
      'phone',
      'projects[0].algorithm',
    ],
    resumeStrategy: '加强 AI 工具使用细节, 展示"懂技术 + 会用 AI"的复合能力',
  },
  career_transition: {
    recommendedRounds: 8,
    priorityFields: [
      'work[0].industry',
      'work[0].transferable',
      'projects[0].story',
      'name',
      'phone',
      'work[0].company',
      'skills',
    ],
    resumeStrategy: '强调过往行业经验 + AI 应用能力, 差异化定位',
  },
  algorithm_research: {
    recommendedRounds: 6,
    priorityFields: [
      'education.research',
      'projects[0].algorithm',
      'publications',
      'name',
      'phone',
      'projects[0].name',
      'skills',
    ],
    resumeStrategy: '补充 AI 应用案例, 展示实操能力',
  },
};

/**
 * 加载 Prompt 模板 + 填入变量
 *
 * @param {Object} params
 * @param {string} params.image - 画像分类
 * @param {Object} params.answers - 5 题答案 (from diagnoseProfile)
 * @param {string} params.currentFieldId - 当前字段 ID
 * @param {string} params.currentValue - 当前值
 * @param {Array} params.answeredFields - 已答字段
 * @param {Array} params.conversationHistory - 对话历史
 * @param {number} params.currentRound - 当前轮数
 * @returns {Promise<{system: string, recommendedRounds: number, priorityFields: Array}>}
 */
async function build(params) {
  const {
    image,
    answers = {},
    currentFieldId,
    currentValue,
    answeredFields = [],
    conversationHistory = [],
    currentRound = 0,
  } = params;

  const strategy = IMAGE_STRATEGY[image];
  if (!strategy) {
    throw new Error(`unknown image: ${image}`);
  }

  // 字段清单 (基于 priorityFields)
  const fields = strategy.priorityFields.map((fieldId) => ({
    fieldId,
    fieldLabel: humanLabel(fieldId),
    priority: 'required', // Week 2 再做 required/optional 区分
  }));

  const remainingRequiredFields = fields
    .filter((f) => !answeredFields.some((a) => a.fieldId === f.fieldId))
    .map((f) => f.fieldId);

  const vars = {
    image,
    education: answers.education || '',
    aiAbility: answers.aiAbility || '',
    projectsSummary: (answers.projects || '').slice(0, 200),
    target: answers.target || '',
    timeline: answers.timeline || '',
    recommendedRounds: strategy.recommendedRounds,
    priorityFields: strategy.priorityFields.join(', '),
    resumeStrategy: strategy.resumeStrategy,
    fields: fields.map((f) => `- ${f.fieldId}: ${f.fieldLabel} (${f.priority})`).join('\n'),
    conversationHistory: JSON.stringify(conversationHistory, null, 2),
    currentFieldId: currentFieldId || '(start)',
    currentFieldLabel: humanLabel(currentFieldId) || '(开场)',
    currentValue: currentValue || '(空)',
    remainingRequiredFields: remainingRequiredFields.join(', ') || '(none)',
    currentRound: `${currentRound} / ${strategy.recommendedRounds}`,
  };

  try {
    const { system } = await buildByCode(PROMPT_CODE, vars);
    return {
      system,
      recommendedRounds: strategy.recommendedRounds,
      priorityFields: strategy.priorityFields,
      image,
    };
  } catch (err) {
    logger.error({ err: err.message, code: PROMPT_CODE }, 'chatBuildPrompt build failed');
    throw err;
  }
}

/**
 * R-JobPilot-v2 W2 T2: 追问深度规则引擎
 *
 * 分析用户回答 + 画像, 输出触发标志 + 推荐的下一字段
 *
 * Triggers:
 *   - tooShort: 用户回答 < 10 字 (追问 "能具体说说吗?")
 *   - hasNumber: 提到 % / 倍 / 万 / 千 (追问 "数字怎么算出来的")
 *   - hasAITool: 提到 Claude / DeepSeek / Coze / Dify (追问 "Prompt 怎么设计")
 *   - isVague: 模糊回答 (大概/可能/差不多) (追问 "给个具体例子")
 *   - isUnknown: 不知道/不清楚 (给示例回答帮用户开口)
 *
 * @param {string} userAnswer - 用户回答
 * @returns {Object} triggers
 */
function analyzeUserAnswer(userAnswer) {
  if (!userAnswer || typeof userAnswer !== 'string') return {};
  return {
    tooShort: userAnswer.length < 10,
    hasNumber: /\d+\s*[%％]|\d+\s*倍|\d+\s*[万千百]/.test(userAnswer),
    hasAITool: /(Claude|DeepSeek|Coze|Dify|GPT|LLM|智能体|Agent)/i.test(userAnswer),
    isVague: /(大概|差不多|可能|应该|也许|或许)/.test(userAnswer),
    isUnknown: /^(不知道|不清楚|没\s|无)/.test(userAnswer.trim()),
  };
}

/**
 * 智能选下一字段 (基于画像 + triggers)
 *
 * 规则:
 *   1. 优先填画像 priorityFields (required 顺序)
 *   2. 触发 hasNumber 后, 跳到 "量化结果" 字段
 *   3. 触发 hasAITool 后, 跳到 "AI 协作细节" 字段
 *   4. 否则按 priorityFields 顺序
 *
 * @param {string} image - 画像分类
 * @param {Array} answeredFields - 已答字段 [{fieldId, ...}]
 * @param {Object} triggers - analyzeUserAnswer 返的触发标志
 * @returns {string|null} nextFieldId (无则 null = 完成)
 */
function pickNextField(image, answeredFields = [], triggers = {}) {
  const strategy = IMAGE_STRATEGY[image];
  if (!strategy) return null;

  const answered = new Set(answeredFields.map((a) => a.fieldId));
  const remaining = strategy.priorityFields.filter((f) => !answered.has(f));

  if (remaining.length === 0) return null;

  // 触发 hasNumber: 优先追问"量化结果"字段
  if (triggers.hasNumber) {
    const quantField = remaining.find((f) => f.endsWith('.result') || f.includes('量化'));
    if (quantField) return quantField;
  }

  // 触发 hasAITool: 优先追问"AI 协作细节"字段
  if (triggers.hasAITool) {
    const aiField = remaining.find((f) => f.includes('aiCollaboration') || f.includes('prompt'));
    if (aiField) return aiField;
  }

  // 触发 tooShort: 跳过"基础字段" (name/phone), 优先"项目细节"
  if (triggers.tooShort) {
    const detailField = remaining.find(
      (f) => f.startsWith('projects[0].') || f.startsWith('work[0].')
    );
    if (detailField) return detailField;
  }

  // 默认: 顺序第一个
  return remaining[0];
}

/**
 * 字段 ID → 中文标签
 */
function humanLabel(fieldId) {
  const map = {
    'name': '姓名',
    'phone': '联系方式',
    'skills': '核心技能',
    'projects[0].name': '项目名称',
    'projects[0].techStack': '技术栈',
    'projects[0].aiCollaboration': 'AI 协作细节',
    'projects[0].result': '量化结果',
    'projects[0].promptStrategy': 'Prompt 设计',
    'projects[0].algorithm': '核心算法',
    'projects[0].story': '项目故事',
    'work[0].company': '最近公司',
    'work[0].industry': '过往行业',
    'work[0].transferable': '可迁移技能',
    'education.detail': '教育细节',
    'education.research': '研究方向',
    'publications': '论文 / 竞赛',
  };
  return map[fieldId] || fieldId;
}

module.exports = {
  build,
  analyzeUserAnswer,
  pickNextField,
  IMAGE_STRATEGY,
  PROMPT_CODE,
};