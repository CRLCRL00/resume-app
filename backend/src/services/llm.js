const axios = require('axios');
const config = require('../config');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const metrics = require('../routes/metrics'); // Prometheus

const TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS) || 30000;
const MAX_RETRIES = Number(process.env.DEEPSEEK_MAX_RETRIES) || 3;

// Simple in-memory metric for retry events
let retriesTotal = 0;
const recordRetry = () => { retriesTotal += 1; };
let failuresTotal = 0;
const recordFailure = () => { failuresTotal += 1; };

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Exponential backoff: 1s, 2s, 4s (with jitter ±20%)
 */
function backoffMs(attempt) {
  const base = 1000 * Math.pow(2, attempt - 1);
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(100, Math.floor(base + jitter));
}

/**
 * Wrap a DeepSeek API call with timeout + retry + 502 surfacing.
 * @param {string} label - for logs/metrics (e.g. 'resume.generate')
 * @param {Function} fn - async () => axiosResponse
 */
async function withRetry(label, fn) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fn();
      if (attempt > 1) {
        logger.info({ label, attempt }, 'llm retry succeeded');
      }
      return res;
    } catch (err) {
      lastErr = err;
      const isTimeout = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT';
      const isNetwork = !err.response;
      const isServer = err.response && err.response.status >= 500;
      const retryable = isTimeout || isNetwork || isServer;

      if (!retryable || attempt === MAX_RETRIES) {
        recordFailure();
        logger.error({
          label,
          attempt,
          err: err.message,
          status: err.response && err.response.status,
        }, 'llm call failed');
        break;
      }
      const delay = backoffMs(attempt);
      recordRetry();
      logger.warn({
        label,
        attempt,
        delay,
        err: err.message,
        status: err.response && err.response.status,
      }, 'llm retry');
      await sleep(delay);
    }
  }
  // Surface 502-ish error
  const e = new Error('LLM upstream unavailable');
  e.statusCode = 502;
  e.cause = lastErr;
  throw e;
}

/**
 * 记录 LLM 调用 token 用量（用于成本监控 + 异常 spike 告警）
 */
function logUsage(callPath, usage, model) {
  if (!usage || typeof usage.total_tokens !== 'number') return;
  metrics.llmCalls.inc({ call_path: callPath, status: 'ok' });
  metrics.llmTokens.inc({ call_path: callPath, kind: 'prompt' }, usage.prompt_tokens || 0);
  metrics.llmTokens.inc({ call_path: callPath, kind: 'completion' }, usage.completion_tokens || 0);
  metrics.llmTokens.inc({ call_path: callPath, kind: 'total' }, usage.total_tokens);
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
    const { data } = await withRetry('llm.chat', () => axios.post(
      `${config.DEEPSEEK.baseURL}/chat/completions`,
      {
        model: opts.model || config.DEEPSEEK.model,
        messages,
        max_tokens: opts.maxTokens || 1000,
        temperature: opts.temperature ?? 0.7,
        ...(opts.responseFormat ? { response_format: opts.responseFormat } : {}),
      },
      {
        timeout: TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.DEEPSEEK.apiKey}`,
        },
      }
    ));
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

module.exports = {
  chat,
  chatJson,
  withRetry,
  retriesTotal: () => retriesTotal,
  failuresTotal: () => failuresTotal,
};