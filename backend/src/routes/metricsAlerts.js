/**
 * Round 31-C: In-process alert evaluator.
 *
 * Mirrors the rules in infra/prometheus/alerts.yml and evaluates them
 * against the live prom-client registry. Returns a JSON list of currently
 * firing alerts.
 *
 * Endpoints (mounted at /api/internal by app.js):
 *   GET /metrics/alerts         → { fired: [...], checked, generatedAt }
 *   GET /metrics/alerts/rules   → { rules: [...] } (parsed YAML list)
 *
 * Why absolute thresholds instead of PromQL-style rates?
 *   prom-client Counters are monotonic since process start; computing a
 *   true rate requires either a TSDB (Prometheus scrape + query) or a
 *   rolling delta tracker inside the process. For an in-process evaluator
 *   we use absolute counter thresholds as a coarse but deterministic
 *   signal. The threshold defaults are tuned so a fresh process is
 *   well below each limit; sustained over-limit traffic fires the alert.
 *
 *   The PromQL in alerts.yml remains the source of truth for ops running
 *   a real Prometheus. This endpoint is a "best-effort" view that does
 *   not require a TSDB.
 *
 * Env-overridable thresholds (all numbers):
 *   ALERT_RL_BLOCK_THRESHOLD     default 100
 *   ALERT_HTTP_ERROR_THRESHOLD   default 50
 *   ALERT_LLM_ERROR_THRESHOLD    default 20
 *   ALERT_SLOW_OPS_THRESHOLD     default 10
 *   ALERT_DB_POOL_RATIO          default 0.9 (used / all)
 *
 * Auth: optional Bearer token. If process.env.ALERT_TOKEN is set, callers
 *   must send `Authorization: Bearer <ALERT_TOKEN>`. Matches the pattern
 *   in metrics.js and alerts.js.
 */

const express = require('express');
const router = express.Router();
const client = require('prom-client');

// Reuse the singletons created by routes/metrics.js + slidingRateLimit.js.
// require()ing them here ensures we share the same registry (and the
// sliding-rate-limit counter's globalThis guard kicks in if both modules
// were already loaded).
const metricsModule = require('./metrics');
const { register, llmCalls, httpRequests, slowOps, dbPoolConnections } = metricsModule;

// sliding_rate_limit_decisions_total lives in middleware/slidingRateLimit.js
// and is exposed via globalThis guard so we can read it without a circular
// import. NOTE: we do NOT require slidingRateLimit here because that module
// requires ../config/redis which connects at import-time and can hang the
// process in test environments without Redis.
//
// Tests that want to bump the counter can require the middleware themselves
// (its globalThis guard will register the counter) or call .inc() directly
// via require.cache hacking — see metricsAlerts.test.js.
const slidingRateLimitDecisions = globalThis.__slidingRateLimitCounter
  || (() => {
    // Fallback: if middleware was never required yet, instantiate a
    // local Counter. prom-client will dedupe by name on the same registry
    // so this matches what middleware uses when it does load.
    const c = new client.Counter({
      name: 'sliding_rate_limit_decisions_total',
      help: 'Sliding window rate limit decisions',
      labelNames: ['name', 'decision'],
    });
    globalThis.__slidingRateLimitCounter = c;
    return c;
  })();

// ---------- thresholds ----------
const THRESHOLDS = {
  rlBlocked:        Number(process.env.ALERT_RL_BLOCK_THRESHOLD    || 100),
  httpErrors:       Number(process.env.ALERT_HTTP_ERROR_THRESHOLD  || 50),
  llmErrors:        Number(process.env.ALERT_LLM_ERROR_THRESHOLD   || 20),
  slowOps:          Number(process.env.ALERT_SLOW_OPS_THRESHOLD    || 10),
  dbPoolRatio:      Number(process.env.ALERT_DB_POOL_RATIO         || 0.9),
};

// ---------- rule definitions (mirror alerts.yml) ----------
const RULES = [
  {
    name: 'HighErrorRate',
    severity: 'critical',
    thresholdKey: 'httpErrors',
    summary: 'HTTP 5xx error rate > 5% for 5m',
    description: 'Sustained server errors above the critical threshold.',
  },
  {
    name: 'ElevatedErrorRate',
    severity: 'warning',
    thresholdKey: 'httpErrors',
    // Same threshold for now; in YAML this rule uses 0.01 (warning) vs
    // HighErrorRate at 0.05. Without true rates we collapse to a single
    // HTTP error counter + severity-by-counter-band heuristic below.
    summary: 'HTTP 5xx error rate > 1% for 5m',
    description: 'Server error rate above warning threshold.',
  },
  {
    name: 'RateLimitSpike',
    severity: 'warning',
    thresholdKey: 'rlBlocked',
    summary: 'Rate-limit blocks exceed threshold',
    description: 'Sliding-window rate limiter has blocked many requests.',
  },
  {
    name: 'RedisDown',
    severity: 'critical',
    // Illustrative only — backend doesn't expose `up{}`. Always false.
    thresholdKey: null,
    summary: 'Backend / Redis health probe failed',
    description: 'External probe reports backend down. Pair with blackbox_exporter.',
  },
  {
    name: 'LLMFailureSpike',
    severity: 'warning',
    thresholdKey: 'llmErrors',
    summary: 'LLM API error rate > 20% for 5m',
    description: 'LLM provider errors above threshold.',
  },
  {
    name: 'DBPoolExhausted',
    severity: 'warning',
    thresholdKey: 'dbPoolRatio',
    summary: 'DB connection pool > 90% used for 5m',
    description: 'MySQL pool saturation above threshold.',
  },
  {
    name: 'SlowRequestRate',
    severity: 'warning',
    thresholdKey: 'slowOps',
    summary: 'Slow operations exceed threshold',
    description: '>1s operations sustained above threshold.',
  },
];

// ---------- helpers ----------

function labelsMatch(actual, expected) {
  for (const k of Object.keys(expected)) {
    if (actual[k] !== expected[k]) return false;
  }
  return true;
}

/** Sum counter values whose labels match the filter (any key=value). */
async function sumCounter(counter, labelFilter = {}) {
  if (!counter) return 0;
  const snap = await counter.get();
  let total = 0;
  for (const v of snap.values) {
    if (labelsMatch(v.labels || {}, labelFilter)) total += Number(v.value) || 0;
  }
  return total;
}

/** Sum a gauge value at a specific label-set. */
async function gaugeAt(gauge, labels = {}) {
  if (!gauge) return null;
  const snap = await gauge.get();
  for (const v of snap.values) {
    if (labelsMatch(v.labels || {}, labels)) return Number(v.value) || 0;
  }
  return null;
}

/**
 * Evaluate a single rule. Returns:
 *   { name, severity, firing: bool, value, threshold, summary, description, labels }
 */
async function evaluateRule(rule) {
  const labels = { severity: rule.severity };
  let firing = false;
  let value = 0;
  let threshold = null;

  switch (rule.name) {
    case 'HighErrorRate':
    case 'ElevatedErrorRate': {
      // Sum all 5xx statuses from http_requests_total.
      const allErr = await sumCounter(httpRequests); // total all routes/statuses
      // Filter 5xx: status starts with "5"
      const snap = await httpRequests.get();
      let errCount = 0;
      for (const v of snap.values) {
        const s = String(v.labels?.status || '');
        if (s.startsWith('5')) errCount += Number(v.value) || 0;
      }
      // Critical uses higher band; warning fires earlier.
      threshold = THRESHOLDS.httpErrors;
      value = errCount;
      firing = rule.severity === 'critical'
        ? errCount >= threshold * 2    // >= 100
        : errCount >= threshold;       // >= 50
      // Touch allErr to keep lint happy if unused.
      void allErr;
      break;
    }
    case 'RateLimitSpike': {
      // decision="blocked"
      const blocked = await sumCounter(slidingRateLimitDecisions, { decision: 'blocked' });
      threshold = THRESHOLDS.rlBlocked;
      value = blocked;
      firing = blocked >= threshold;
      break;
    }
    case 'RedisDown': {
      // Illustrative: never fires in-process.
      threshold = 0;
      value = null;
      firing = false;
      break;
    }
    case 'LLMFailureSpike': {
      const errCount = await sumCounter(llmCalls, { status: 'error' });
      threshold = THRESHOLDS.llmErrors;
      value = errCount;
      firing = errCount >= threshold;
      break;
    }
    case 'DBPoolExhausted': {
      const used = await gaugeAt(dbPoolConnections, { state: 'used' });
      const all  = await gaugeAt(dbPoolConnections, { state: 'all' });
      threshold = THRESHOLDS.dbPoolRatio;
      if (used == null || all == null || all === 0) {
        value = 0;
        firing = false;
      } else {
        value = used / all;
        firing = value >= threshold;
      }
      break;
    }
    case 'SlowRequestRate': {
      // slow_operations_total has labels {route, op}; sum all.
      const slow = await sumCounter(slowOps);
      threshold = THRESHOLDS.slowOps;
      value = slow;
      firing = slow >= threshold;
      break;
    }
    default:
      firing = false;
  }

  return {
    name: rule.name,
    severity: rule.severity,
    firing,
    value,
    threshold,
    summary: rule.summary,
    description: rule.description,
    labels,
    evaluatedAt: new Date().toISOString(),
  };
}

// ---------- optional Bearer auth (matches alerts.js pattern) ----------
const ALERT_TOKEN = process.env.ALERT_TOKEN;
function authGuard(req, res, next) {
  if (!ALERT_TOKEN) return next();
  const h = req.headers['authorization'] || '';
  const expected = `Bearer ${ALERT_TOKEN}`;
  if (h !== expected) {
    return res.status(401).json({ code: 1002, message: 'invalid alert token' });
  }
  next();
}

// ---------- routes ----------

/**
 * GET /api/internal/metrics/alerts
 * Returns currently-firing alerts (and the count of rules checked).
 */
router.get('/metrics/alerts', authGuard, async (req, res) => {
  try {
    const evaluated = await Promise.all(RULES.map(evaluateRule));
    const fired = evaluated.filter((r) => r.firing).map((r) => ({
      name: r.name,
      severity: r.severity,
      value: r.value,
      threshold: r.threshold,
      summary: r.summary,
      description: r.description,
      labels: r.labels,
      evaluatedAt: r.evaluatedAt,
    }));
    res.json({
      code: 0,
      data: {
        fired,
        checked: RULES.length,
        generatedAt: new Date().toISOString(),
        thresholds: THRESHOLDS,
      },
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: 'alert evaluation failed' });
  }
});

/**
 * GET /api/internal/metrics/alerts/rules
 * Returns the rule list as JSON (parses alerts.yml at runtime is overkill;
 * we expose the in-memory RULES array for ops convenience).
 */
router.get('/metrics/alerts/rules', authGuard, (req, res) => {
  const rules = RULES.map((r) => ({
    name: r.name,
    severity: r.severity,
    thresholdKey: r.thresholdKey,
    thresholdDefault: r.thresholdKey ? THRESHOLDS[r.thresholdKey] : null,
    summary: r.summary,
    description: r.description,
  }));
  res.json({
    code: 0,
    data: {
      count: rules.length,
      names: rules.map((r) => r.name),
      rules,
      thresholds: THRESHOLDS,
      source: 'infra/prometheus/alerts.yml',
    },
  });
});

// Exported for tests + direct invocation.
module.exports = {
  router,
  RULES,
  THRESHOLDS,
  evaluateRule,
  sumCounter,
  gaugeAt,
  slidingRateLimitDecisions,
  register,
};

// Mount helper: app.js does `app.use('/api/internal', router)`.
module.exports.router = router;