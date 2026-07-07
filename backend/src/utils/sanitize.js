// 防止 LLM prompt injection：从用户文本里剥离可能被模型误读的指令
const MAX_USER_TEXT = 8000; // 单字段长度上限
const ROLE_TAGS = [
  /<\s*\/?\s*(system|user|assistant|tool|function|developer|human)\s*>/gi,
  /\[\s*(system|user|assistant)\s*[:|]/gi,
  /```\s*(system|assistant|user)[\s\S]*?(?:```|$)/gi,
  /<<\s*(SYS|USER|INST|INSTRUCT)\s*>>/gi,
];
const CTRL_CHARS = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g;

function sanitizeForLlm(input, { max = MAX_USER_TEXT } = {}) {
  if (input == null) return '';
  let s = String(input);
  // 1. 去控制字符
  s = s.replace(CTRL_CHARS, '');
  // 2. 去 role tags（用户输入里的 <system> 等）
  for (const re of ROLE_TAGS) s = s.replace(re, '');
  // 3. 截断
  if (s.length > max) s = s.slice(0, max);
  // 4. 折叠连续空白
  s = s.replace(/\n{4,}/g, '\n\n\n').replace(/[ \t]{4,}/g, '   ');
  return s.trim();
}

// 递归 sanitize 对象/数组里的所有字符串值
function sanitizeForLlmDeep(value, opts) {
  if (value == null) return value;
  if (typeof value === 'string') return sanitizeForLlm(value, opts);
  if (Array.isArray(value)) return value.map(v => sanitizeForLlmDeep(v, opts));
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = sanitizeForLlmDeep(value[k], opts);
    return out;
  }
  return value;
}

module.exports = { sanitizeForLlm, sanitizeForLlmDeep, MAX_USER_TEXT };
