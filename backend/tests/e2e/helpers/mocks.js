// E2E test mocks: stub external services via require.cache injection.
// Pattern mirrors backend/tests/slidingRateLimit.test.js.
//
// IMPORTANT: we only swap the wechat + llm entries — never evict other
// downstream modules. Eviction causes "metric already registered" failures
// because metrics.js is a singleton with global Prometheus state.

const path = require('node:path');

function wechatServicePath() {
  // mocks.js lives at backend/tests/e2e/helpers/mocks.js
  return require.resolve(path.join(__dirname, '..', '..', '..', 'src', 'services', 'wechat'));
}

function llmServicePath() {
  return require.resolve(path.join(__dirname, '..', '..', '..', 'src', 'services', 'llm'));
}

/**
 * Stub services/wechat.js so /login maps wx.login codes to openids.
 * - If `openidOrMap` is a string, every code maps to that openid (simple mode).
 * - If `openidOrMap` is a Record<code, openid>, the code picks the openid
 *   (multi-actor mode — avoids re-creating app between admin/user logins).
 * Must run BEFORE app is required so routes/auth.js picks up the stub.
 */
function mockWechat(openidOrMap) {
  const wp = wechatServicePath();
  require.cache[wp] = {
    id: wp,
    filename: wp,
    loaded: true,
    exports: {
      code2session: async (code) => {
        const openid = typeof openidOrMap === 'string'
          ? openidOrMap
          : (openidOrMap[code] || Object.values(openidOrMap)[0]);
        return { openid, session_key: 'mock-session-key' };
      },
    },
    paths: [],
  };
}

/**
 * Stub services/llm.js exports (`chat` + `chatJson`) with deterministic fakes.
 * - chat() returns `{ content, usage }`
 * - chatJson() parses content as JSON and returns `{ parsed, usage }`
 */
function mockLlm(content = '# mock resume\n## mocked section') {
  const lp = llmServicePath();
  const parsed = {
    results: [
      { job_id: 1, score: 88, reason: 'strong skill match' },
    ],
  };
  require.cache[lp] = {
    id: lp,
    filename: lp,
    loaded: true,
    exports: {
      chat: async () => ({ content, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
      chatJson: async () => ({ parsed, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
      withRetry: async (_label, fn) => fn(),
      retriesTotal: () => 0,
      failuresTotal: () => 0,
    },
    paths: [],
  };
}

/**
 * Remove injected stubs only. Downstream modules stay cached so their
 * module-level singletons (Prometheus metrics, DB pool, Redis client) are
 * not re-instantiated, which would cause "already registered" / leaked
 * connection errors.
 */
function restoreMocks() {
  try { delete require.cache[wechatServicePath()]; } catch {}
  try { delete require.cache[llmServicePath()]; } catch {}
}

module.exports = { mockWechat, mockLlm, restoreMocks };