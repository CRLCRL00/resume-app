#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Deploy smoke test — 8-step endpoint liveness probe.
 *
 * Cross-platform (Node 20+ global fetch, no shell deps), works on Windows + Linux.
 * Exit 0 on all pass, 1 on any fail. Prints PASS/FAIL summary.
 *
 * Usage:
 *   node scripts/smoke.js                    # probes default (serveo prod URL)
 *   BASE_URL=http://localhost:3000 node scripts/smoke.js
 *   BASE_URL=https://staging.example.com ALERT_TOKEN=xxx node scripts/smoke.js
 *   node scripts/smoke.js --help
 *
 * Env:
 *   BASE_URL     default: https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com
 *   ALERT_TOKEN  default: dev-alert-token-change-me  (optional, metrics route is open)
 */

'use strict';

const DEFAULT_BASE = 'https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com';
const DEFAULT_ALERT = 'dev-alert-token-change-me';
const TIMEOUT_MS = 10_000;

// ----- CLI args -----
const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  process.stdout.write(
    [
      'scripts/smoke.js — deploy endpoint liveness probe',
      '',
      'Usage:',
      '  node scripts/smoke.js                   Probe default BASE_URL (serveo prod)',
      '  BASE_URL=<url> node scripts/smoke.js    Probe custom URL',
      '  ALERT_TOKEN=<t> node scripts/smoke.js   Bearer token for /api/internal/metrics*',
      '  node scripts/smoke.js --help           Show this help',
      '',
      'Exit codes:',
      '  0  all steps passed',
      '  1  one or more steps failed',
      '  2  usage error',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const BASE = process.env.BASE_URL || DEFAULT_BASE;
const ALERT_TOKEN = process.env.ALERT_TOKEN || DEFAULT_ALERT;

// ----- Output helpers (ANSI color, auto-disable on non-TTY / Windows legacy cmd) -----
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = useColor
  ? {
      green: (s) => `\x1b[32m${s}\x1b[0m`,
      red: (s) => `\x1b[31m${s}\x1b[0m`,
      dim: (s) => `\x1b[2m${s}\x1b[0m`,
      bold: (s) => `\x1b[1m${s}\x1b[0m`,
    }
  : { green: (s) => s, red: (s) => s, dim: (s) => s, bold: (s) => s };

const out = process.stdout.write.bind(process.stdout);
const log = (line) => out(`${line}\n`);

// ----- HTTP helper -----
async function probe(method, path, { body, headers, expectStatus, validate } = {}) {
  const url = `${BASE}${path}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...(headers || {}) },
      body,
      signal: ac.signal,
    });
    const status = res.status;
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_e) {
      data = null;
    }
    const ms = Date.now() - t0;
    if (status !== expectStatus) {
      return {
        ok: false,
        reason: `expected ${expectStatus}, got ${status} (${ms}ms): ${text.slice(0, 120)}`,
      };
    }
    if (validate) {
      const v = validate({ status, data, text });
      if (v !== true) return { ok: false, reason: v || 'validation failed' };
    }
    return { ok: true, ms };
  } catch (err) {
    return { ok: false, reason: err.name === 'AbortError' ? err.message : `fetch: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

// ----- Steps -----
const STEPS = [
  {
    label: `GET ${BASE}/api/health`,
    run: () =>
      probe('GET', '/api/health', {
        expectStatus: 200,
        validate: ({ data }) => {
          if (!data || typeof data !== 'object') return 'not JSON object';
          const status = data.data?.status;
          if (status !== 'ok') return `expected status=ok, got ${status}`;
          return true;
        },
      }),
  },
  {
    label: `GET ${BASE}/api/health/ready`,
    run: () =>
      probe('GET', '/api/health/ready', {
        expectStatus: 200,
        validate: ({ data }) => {
          if (!data || typeof data !== 'object') return 'not JSON object';
          if (data.status !== 'ready') return `expected status=ready, got ${data.status}`;
          if (data.db !== 'ok') return `db=${data.db}`;
          if (data.redis !== 'ok') return `redis=${data.redis}`;
          return true;
        },
      }),
  },
  {
    label: `POST ${BASE}/api/resume/generate (expect 401, no auth)`,
    run: () =>
      probe('POST', '/api/resume/generate', {
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
        expectStatus: 401,
      }),
  },
  {
    label: `GET ${BASE}/api/docs (Swagger UI HTML)`,
    run: () =>
      probe('GET', '/api/docs', {
        expectStatus: 200,
        validate: ({ data, text }) => {
          // Some doc layouts emit JSON; some emit HTML. Accept either as long as 200 + non-empty.
          if (!text || text.length < 10) return 'empty body';
          return true;
        },
      }),
  },
  {
    label: `POST ${BASE}/api/auth/login {} (expect 400 missing code)`,
    run: () =>
      probe('POST', '/api/auth/login', {
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
        expectStatus: 400,
        validate: ({ data }) => {
          if (!data || typeof data !== 'object') return 'not JSON object';
          if (data.code === 1000) return true;
          return `expected code=1000, got ${data.code}`;
        },
      }),
  },
  {
    label: `GET ${BASE}/api/internal/metrics (Prometheus exposition)`,
    run: () =>
      probe('GET', '/api/internal/metrics', {
        headers: { Authorization: `Bearer ${ALERT_TOKEN}` },
        expectStatus: 200,
        validate: ({ text }) => {
          if (!text || !text.includes('http_requests_total')) {
            return 'body missing http_requests_total';
          }
          return true;
        },
      }),
  },
  {
    label: `GET ${BASE}/api/internal/metrics/summary (JSON)`,
    run: () =>
      probe('GET', '/api/internal/metrics/summary', {
        headers: { Authorization: `Bearer ${ALERT_TOKEN}` },
        expectStatus: 200,
        validate: ({ data }) => {
          if (!data || typeof data !== 'object') return 'not JSON object';
          if (data.code !== 0) return `expected code=0, got ${data.code}`;
          if (!data.data || typeof data.data !== 'object') return 'missing data';
          return true;
        },
      }),
  },
  {
    label: `POST ${BASE}/api/auth/refresh {} (expect 400 missing refresh_token)`,
    run: () =>
      probe('POST', '/api/auth/refresh', {
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
        expectStatus: 400,
      }),
  },
];

// ----- Main -----
(async () => {
  log(c.bold(`Smoke probe → ${BASE}`));
  log(c.dim(`Time: ${new Date().toISOString()}`));
  log('');

  let pass = 0;
  let fail = 0;
  const total = STEPS.length;
  let firstFail = null;

  for (let i = 0; i < STEPS.length; i++) {
    const idx = i + 1;
    const step = STEPS[i];
    const result = await step.run();
    if (result.ok) {
      pass++;
      log(`[${idx}/${total}] ${c.green('OK')}   ${step.label} (${result.ms ?? '?'}ms)`);
    } else {
      fail++;
      if (!firstFail) firstFail = idx;
      log(`[${idx}/${total}] ${c.red('FAIL')} ${step.label}`);
      log(`         ${c.red('reason:')} ${result.reason}`);
    }
  }

  log('');
  log(`Smoke: ${c.bold(`${pass}/${total}`)} passed${fail ? `, ${fail} failed` : ''}`);
  if (fail) {
    log(c.red(`SMOKE FAILED (first failure: step ${firstFail})`));
    process.exit(1);
  } else {
    log(c.green('SMOKE OK'));
    process.exit(0);
  }
})().catch((err) => {
  // Should never reach here — steps swallow their own errors.
  log(c.red(`FATAL: ${err.stack || err.message}`));
  process.exit(1);
});
