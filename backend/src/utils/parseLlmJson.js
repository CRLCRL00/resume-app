/**
 * LLM 输出 JSON 解析工具
 *
 * LLM 输出常见格式问题:
 *   1. 标准 JSON → 直接 parse
 *   2. 包 ```json ... ``` 包裹 → 剥掉再 parse
 *   3. 多余前后缀文字 → 找 { } 区间再 parse
 *   4. 单引号/中文标点/缺引号 → fallback 到 plain text
 *
 * 抽成独立模块的好处:
 *   - 不依赖 DB (无 require('../config/db'))
 *   - 单元测试不需 setup
 *   - 可被多个 service 复用
 */

'use strict';

/**
 * 解析 LLM 输出,返回 { data, mode }
 * @param {string} text - LLM 输出
 * @returns {{ data: object, mode: 'structured' | 'plaintext' }}
 *   - structured: LLM 返了合法 JSON,data 含结构化字段
 *   - plaintext: LLM 返了纯文本,data 仅含 resume (全文)
 */
function parseLlmJson(text) {
  if (typeof text !== 'string') {
    throw new TypeError('parseLlmJson requires string input');
  }

  // 公共 plaintext fallback 结构
  const fallback = (resumeText) => ({
    data: { resume: resumeText, storyPoints: [] },
    mode: 'plaintext',
  });

  // 处理空字符串 / 纯空白:保留原文
  if (!text.trim()) {
    return fallback(text);
  }

  const trimmed = text.trim();

  // 1. 直接尝试
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { data: normalize(parsed), mode: 'structured' };
    }
  } catch (_) { /* fall through */ }

  // 2. 剥 ```json ... ``` 包裹
  const m = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (m) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { data: normalize(parsed), mode: 'structured' };
      }
    } catch (_) { /* fall through */ }
  }

  // 3. 找第一个 { 到最后一个 }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { data: normalize(parsed), mode: 'structured' };
      }
    } catch (_) { /* fall through */ }
  }

  // 4. Fallback: 当纯文本 (保留原文,trim 一下)
  return fallback(trimmed);
}

/**
 * 规范化 JSON 数据,补全缺失字段 + 类型校验
 * @param {object} raw
 * @returns {object} { resume, storyPoints }
 */
function normalize(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { resume: '', storyPoints: [] };
  }

  return {
    resume: typeof raw.resume === 'string' ? raw.resume : '',
    storyPoints: Array.isArray(raw.storyPoints) ? raw.storyPoints : [],
  };
}

module.exports = { parseLlmJson, normalize };