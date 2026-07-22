// R114 T1: AI assistant — resume field help
// POST /api/ai/assist-field
// - 输入: {fieldId, fieldLabel, currentValue, history[]}
// - 输出: {opening, followups[], suggestion}
// - 复用 services/llm.js:chatJson (deepseek, key 已配)
// - userAuth + validateBody(assistFieldSchema) + AppError 转发（错误格式与全局一致）
// - prompt injection 防御: <user_input> boundary tokens + 清洗换行符
const express = require('express');
const router = express.Router();
const { userAuth } = require('../middleware/auth');
const { validateBody, assistFieldSchema } = require('../middleware/validate');
const llm = require('../services/llm');
const logger = require('../utils/logger');

// 清洗 user 输入：换行符替换为空格（防注入换行破坏 prompt 结构）+ 截断
function sanitizeInput(s, max = 2000) {
  return String(s == null ? '' : s).replace(/\n/g, ' ').slice(0, max);
}

router.post('/assist-field', userAuth, validateBody(assistFieldSchema), async (req, res, next) => {
  try {
    const {
      mode,
      fieldId,
      fieldLabel,
      currentValue,
      history,
      answeredFields,
    } = req.body;

    const safeLabel = sanitizeInput(fieldLabel, 64);
    const safeValue = sanitizeInput(currentValue, 2000);

    let systemPrompt;
    let userMessage;
    let maxTokens;
    if (mode === 'wizard') {
      const answeredSummary = answeredFields
        .map((f) => `${sanitizeInput(f.fieldLabel, 64)}: ${sanitizeInput(f.value, 2000)}`)
        .join('\n');
      systemPrompt = `你是简历面试官。候选人正在按顺序填简历。

候选人已答字段:
${answeredSummary || '(无, 刚开始)'}

当前字段: <user_input>${safeLabel}</user_input>
当前值: <user_input>${safeValue || '(空)'}</user_input>

任务: 像面试官一样主动问 1 个具体问题, 帮候选人把这字段填好。
- nextQuestion: 1 个具体问题 (亲切自然, 不超过 30 字)
- hint: 1 个简短提示 (≤20 字), 让候选人知道怎么答
- isComplete: 当前字段是否已完成 (当前值足够好就 true, 还差就 false)
- recommendations: 给 3 个推荐答案 (Tinder 划卡), 每项 {value, reason}:
  - value: 用户可能填的具体值 (≤20 字, 字段合理可填)
  - reason: 选这个的理由 (≤15 字)
  - 基于已答字段 + 通用知识推断, 越具体越好

输出 JSON: {"nextQuestion": "...", "hint": "...", "isComplete": false, "recommendations": [{"value": "...", "reason": "..."}, ...]}`;
      userMessage = `请对"${safeLabel}"字段提一个问题`;
      maxTokens = 350;
    } else {
      systemPrompt = `你是简历助手。<user_input>用户正在填写"${safeLabel}"字段。当前值: "${safeValue}"。</user_input>任务:
1. 给一句开场白 (亲切自然, 不超过 20 字)
2. 给出 1-3 个追问 (帮用户补充更多信息)
3. 给一个具体建议 (如何让这条信息更有吸引力)
输出 JSON: {"opening": "...", "followups": ["...", "..."], "suggestion": "..."}`;
      userMessage = `我的 ${safeLabel}: ${safeValue || '(空)'}`;
      maxTokens = 400;
    }

    // history 也包裹 boundary token + 清洗，防止历史消息里夹带注入
    const safeHistory = history.map(m => ({
      role: m.role,
      content: `<user_input>${sanitizeInput(m.content, 2000)}</user_input>`,
    }));

    const messages = [
      { role: 'system', content: systemPrompt },
      ...safeHistory,
      { role: 'user', content: `<user_input>${userMessage}</user_input>` },
    ];

    const { parsed, usage } = await llm.chatJson(messages, {
      operation: mode === 'wizard' ? 'ai.wizard' : 'ai.assistField',
      maxTokens,
      temperature: 0.7,
    });

    logger.info({ mode, fieldId, usage }, 'ai assist-field ok');
    res.json({ code: 0, data: parsed, message: 'success' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
