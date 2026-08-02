const pool = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

/**
 * R-JobPilot-v2: 通用按 code 加载 Prompt 模板 (从 prompts 表)
 * 支持多 code (resume_generate / chat_build_next_question 等)
 *
 * @param {string} code - prompt code (e.g. 'resume_generate', 'chat_build_next_question')
 * @param {Object} vars - 模板变量 (e.g. {image, currentFieldId, conversationHistory})
 * @returns {Promise<{system: string, user: string}>}
 */
async function buildByCode(code, vars = {}) {
  const [rows] = await pool.query(
    'SELECT content FROM prompts WHERE code = ? AND is_active = 1 LIMIT 1',
    [code]
  );
  if (!rows.length) throw new AppError(1200, `prompt not configured: ${code}`, 500);

  let content = rows[0].content;

  // 简单模板替换: {{varName}} → vars[varName]
  for (const [k, v] of Object.entries(vars)) {
    content = content.replace(new RegExp(`{{${k}}}`, 'g'), String(v ?? ''));
  }

  // 兼容旧版: {user_form} 替换为空 (保留向后兼容)
  content = content.replace('{user_form}', '');

  return { system: content.trim(), user: '' };
}

/**
 * 旧版 API: 加载 resume_generate Prompt (用于 resumeGenerator.generate)
 * 保持兼容, 内部走 buildByCode
 *
 * @param {Object} sourceForm - 用户填的资料
 * @returns {Promise<{system: string, user: string}>}
 */
async function build(sourceForm) {
  const { system } = await buildByCode('resume_generate', {});
  const user = JSON.stringify(sourceForm, null, 2);
  return { system, user };
}

module.exports = { build, buildByCode };