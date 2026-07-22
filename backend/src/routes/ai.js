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
    const { fieldId, fieldLabel, currentValue, history } = req.body;

    const safeLabel = sanitizeInput(fieldLabel, 64);
    const safeValue = sanitizeInput(currentValue, 2000);

    const systemPrompt = `你是简历助手。<user_input>用户正在填写"${safeLabel}"字段。当前值: "${safeValue}"。</user_input>任务:
1. 给一句开场白 (亲切自然, 不超过 20 字)
2. 给出 1-3 个追问 (帮用户补充更多信息)
3. 给一个具体建议 (如何让这条信息更有吸引力)
输出 JSON: {"opening": "...", "followups": ["...", "..."], "suggestion": "..."}`;

    // history 也包裹 boundary token + 清洗，防止历史消息里夹带注入
    const safeHistory = history.map(m => ({
      role: m.role,
      content: `<user_input>${sanitizeInput(m.content, 2000)}</user_input>`,
    }));

    const messages = [
      { role: 'system', content: systemPrompt },
      ...safeHistory,
      { role: 'user', content: `<user_input>我的 ${safeLabel}: ${safeValue || '(空)'}</user_input>` },
    ];

    const { parsed, usage } = await llm.chatJson(messages, {
      operation: 'ai.assistField',
      maxTokens: 400,
      temperature: 0.7,
    });

    logger.info({ fieldId, usage }, 'ai assist-field ok');
    res.json({ code: 0, data: parsed, message: 'success' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
