// Chaos test helpers — fail-open / graceful-degradation stubs.
//
// These stubs are pure JS objects designed to be injected via require.cache
// to simulate infrastructure failures (Redis / MySQL / LLM) WITHOUT making
// real network calls. Tests verify the app degrades gracefully.
//
// Usage:
//   const stubs = require('./helpers/chaosStubs');
//   stubs.installRedis();         // inject failing redis module
//   stubs.installDb();            // inject failing db pool module
//   stubs.installLlm(async () => { throw new Error('llm down'); });
//   ... tests ...
//   stubs.restoreAll();           // tear down all stubs (also in afterEach)
//
// Each install() also patches the relevant dependent module (e.g. token
// service, slidingRateLimit, rateLimit, llm service) so that the new
// stub is picked up on the next require.

const path = require('node:path');

const REDIS_PATH = require.resolve('../../../src/config/redis');
const DB_PATH = require.resolve('../../../src/config/db');
const LLM_PATH = require.resolve('../../../src/services/llm');
const TOKEN_PATH = require.resolve('../../../src/services/token');
const RATE_LIMIT_PATH = require.resolve('../../../src/services/rateLimit');
const SLIDING_PATH = require.resolve('../../../src/middleware/slidingRateLimit');
const WECHAT_PATH = require.resolve('../../../src/services/wechat');

// ---- internal registry ----
const installed = new Set();

function patchCache(modulePath, exports) {
  const original = require.cache[modulePath];
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
    children: original ? original.children : [],
    paths: original ? original.paths : [],
  };
}

function clearCache(modulePath) {
  delete require.cache[modulePath];
}

function clearDependentCaches() {
  // Wipe modules that captured our stubs in their local `redis`/`pool`/`llm`
  // bindings, so a re-require re-binds.
  clearCache(TOKEN_PATH);
  clearCache(RATE_LIMIT_PATH);
  clearCache(SLIDING_PATH);
  // LLM is patched by replacing the function on the module object, not require.cache
  clearCache(require.resolve('../../../src/services/resumeGenerator'));
  clearCache(require.resolve('../../../src/services/matchService'));
  clearCache(WECHAT_PATH);
}

// ============================================================
//  Redis stub — every command rejects
// ============================================================
function failRedis() {
  const err = () => Promise.reject(new Error('redis connection refused (chaos)'));
  // pipeline API used by slidingRateLimit
  const makePipeline = () => {
    const pipeline = {
      zremrangebyscore: () => pipeline,
      zcard: () => pipeline,
      zadd: () => pipeline,
      pexpire: () => pipeline,
      exec: () => Promise.reject(new Error('redis connection refused (chaos)')),
    };
    return pipeline;
  };
  return {
    // ioredis-style
    multi: makePipeline,
    pipeline: makePipeline,
    get: () => err(),
    set: () => err(),
    del: () => err(),
    incr: () => err(),
    expire: () => err(),
    ttl: () => err(),
    keys: () => err(),
    ping: () => err(),
    call: () => err(),
    // transaction / info
    info: () => err(),
    config: () => err(),
    quit: () => Promise.resolve(),
    disconnect: () => {},
    on: () => {},
    off: () => {},
    // placeholder for unknown methods → reject
    // (caller will see Promise rejection → upstream catch)
  };
}

// ============================================================
//  MySQL pool stub — query/execute reject
// ============================================================
function failDb() {
  const err = new Error('mysql pool exhausted (chaos)');
  const reject = () => Promise.reject(err);
  // Match a subset of the real pool's surface so that nothing crashes on
  // property access; only the I/O methods reject.
  return {
    query: () => reject(),
    execute: () => reject(),
    getConnection: () => reject(),
    beginTransaction: () => reject(),
    end: () => Promise.resolve(),
    on: () => {},
    pool: {
      _allConnections: [],
      _freeConnections: [],
      _connectionQueue: [],
    },
  };
}

// ============================================================
//  LLM stub — controlled delay + abort signal
// ============================================================
function slowLlm(delayMs = 10_000, opts = {}) {
  const errorMessage = opts.errorMessage || 'llm upstream unavailable (chaos)';
  return {
    chat: (messages, _opts) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Resolve successfully (e.g. tests want a successful slow call)
        if (opts.resolveContent != null) {
          resolve({ content: opts.resolveContent, usage: { total_tokens: 1 } });
        } else {
          reject(Object.assign(new Error(errorMessage), { statusCode: 502 }));
        }
      }, delayMs);
      // If opts.signal is provided, abort on signal
      if (opts.signal) {
        opts.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          const e = new Error('aborted (chaos)');
          e.name = 'AbortError';
          e.code = 'ABORT_ERR';
          reject(e);
        }, { once: true });
      }
    }),
    chatJson: (messages, _opts) => slowLlm(delayMs, opts).chat(messages, _opts).then((r) => ({
      parsed: { ok: true, text: r.content },
      usage: r.usage,
    })),
    withRetry: () => Promise.reject(Object.assign(new Error(errorMessage), { statusCode: 502 })),
    retriesTotal: () => 0,
    failuresTotal: () => 0,
  };
}

// ============================================================
//  Install / restore
// ============================================================
function installRedis() {
  patchCache(REDIS_PATH, failRedis());
  installed.add('redis');
  clearDependentCaches();
}
function installDb() {
  patchCache(DB_PATH, failDb());
  installed.add('db');
  clearDependentCaches();
}
function installLlm(llm) {
  // Don't blow away require.cache for llm — it has internal state. Instead,
  // patch the exports object in-place (this is the pattern tests/helpers/llm.js
  // already uses).
  const llmMod = require(LLM_PATH);
  llmMod.chat = llm.chat;
  llmMod.chatJson = llm.chatJson;
  llmMod.withRetry = llm.withRetry;
  installed.add('llm');
}
function installWechat(wechat) {
  // wechat exports a singleton; patch in place
  const w = require(WECHAT_PATH);
  Object.assign(w, wechat);
  installed.add('wechat');
}

function restoreAll() {
  // LLM
  if (installed.has('llm')) {
    try {
      const llmMod = require(LLM_PATH);
      // Re-require a fresh copy to restore original functions. We can't
      // easily reset to the original `axios.post`-based impl without keeping
      // a snapshot; tests that need pristine LLM should simply not stub it
      // (or restore via the same module-export trick helpers/llm.js uses).
      // We default to a no-op "throw not implemented" so any later call
      // fails loudly — that's the safe default.
      llmMod.chat = () => Promise.reject(new Error('llm not restored'));
      llmMod.chatJson = () => Promise.reject(new Error('llm not restored'));
      llmMod.withRetry = () => Promise.reject(new Error('llm not restored'));
    } catch (_e) { /* module may be re-required fresh */ }
  }
  if (installed.has('wechat')) {
    // wechat singleton has no clean reset; downstream code paths that need
    // real wechat should `restoreAll()` before they require.
  }

  // Redis / Db — drop cache entries so next require re-loads the real module
  if (installed.has('redis')) {
    clearCache(REDIS_PATH);
    clearDependentCaches();
  }
  if (installed.has('db')) {
    clearCache(DB_PATH);
    clearDependentCaches();
  }

  installed.clear();
}

module.exports = {
  // stubs
  failRedis,
  failDb,
  slowLlm,
  // install
  installRedis,
  installDb,
  installLlm,
  installWechat,
  restoreAll,
  // paths (exposed for tests that want finer control)
  paths: {
    REDIS_PATH, DB_PATH, LLM_PATH, TOKEN_PATH, RATE_LIMIT_PATH, SLIDING_PATH, WECHAT_PATH,
  },
};
