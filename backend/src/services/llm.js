const axios = require('axios');
const config = require('../config');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

/**
 * 记录 LLM 调用 token 用量（用于成本监控 + 异常 spike 告警）
 */
function logUsage(callPath, usage, model) {
  if (!usage || typeof usage.total_tokens !== 'number') return;
  logger.info({
    llm: callPath,
    model: model || config.DEEPSEEK.model,
    prompt_tokens: usage.prompt_tokens || 0,
    completion_tokens: usage.completion_tokens || 0,
    total_tokens: usage.total_tokens,
  }, 'llm usage');
}

async function chat(messages, opts = {}) {
  try {
    const { data } = await axios.post(
      `${config.DEEPSEEK.baseURL}/chat/completions`,
      {
        model: opts.model || config.DEEPSEEK.model,
        messages,
        max_tokens: opts.maxTokens || 1000,
        temperature: opts.temperature ?? 0.7,
        ...(opts.responseFormat ? { response_format: opts.responseFormat } : {}),
      },
      {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.DEEPSEEK.apiKey}`,
        },
      }
    );
    logUsage('chat', data.usage, opts.model);
    return {
      content: data.choices[0].message.content,
      usage: data.usage,
    };
  } catch (err) {
    if (err.response) {
      throw new AppError(
        1100,
        `llm api error: ${err.response.data?.error?.message || err.message}`,
        502
      );
    }
    throw new AppError(1100, `llm network error: ${err.message}`, 502);
  }
}

async function chatJson(messages, opts = {}) {
  const result = await chat(messages, {
    ...opts,
    responseFormat: { type: 'json_object' },
  });

  let text = result.content.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  try {
    return { parsed: JSON.parse(text), usage: result.usage };
  } catch (err) {
    throw new AppError(1101, `llm returned invalid json: ${text.slice(0, 100)}`, 502);
  }
}

module.exports = { chat, chatJson };