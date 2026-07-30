# Smoke Test (`scripts/smoke.js`)

Cross-platform (Node 20+ global `fetch`, no shell deps) deploy-time endpoint
liveness probe. Runs on Windows + Linux identically. Hits a deployed backend
and verifies 8 critical endpoints respond as expected.

## What it tests + why

This catches the **"deploy succeeded but the service crashed / misrouted"**
class of bug that CI can't see:

| # | Step                                  | Expected                           | Catches                                      |
|---|---------------------------------------|------------------------------------|----------------------------------------------|
| 1 | `GET  /api/health`                    | 200 + `data.status === 'ok'`       | DB / Redis down, syntax error on boot        |
| 2 | `GET  /api/health/ready`              | 200 + `status='ready'`             | k8s readiness would silently fail to flip    |
| 3 | `POST /api/resume/generate` `{}`      | 401 (no auth)                      | auth middleware bypassed / router missing    |
| 4 | `GET  /api/docs`                      | 200 HTML/JSON                      | OpenAPI mount broken                         |
| 5 | `POST /api/auth/login` `{}`           | 400 `code:1000`                    | login route missing "code is required" guard |
| 6 | `GET  /api/internal/metrics`          | 200 + Prometheus text              | prom-client registry not wired up            |
| 7 | `GET  /api/internal/metrics/summary`  | 200 + JSON `{code:0, data:{...}}`  | snapshot helper crash                        |
| 8 | `POST /api/auth/refresh` `{}`         | 400 (missing refresh_token)        | joi schema + error handler crash             |

> Note: live serveo tunnel rejected the original `GET /api/jobs` (404 — only
> `/api/jobs/:id` exists) and `POST /api/internal/client-errors` (404 — not yet
> deployed). Smoke substitutes with endpoints present in the live deploy.

**It deliberately does NOT** touch LLM, WeChat, DB writes, or any real auth
flow — that's the e2e suite's job. Smoke is purely about "did the process boot,
did routing mount, did middleware stack assemble correctly".

## How to run

```bash
# from repo root
npm run smoke          # default BASE_URL (serveo prod tunnel)
npm run smoke:prod     # explicit, same as above

# local
BASE_URL=http://localhost:3000 npm run smoke

# staging with auth
BASE_URL=https://staging.example.com \
ALERT_TOKEN=ey...       npm run smoke

# pnpm / yarn — works the same
pnpm smoke
yarn smoke

# bypass all colors (e.g., in CI logs)
NO_COLOR=1 npm run smoke

# help
node scripts/smoke.js --help
```

### Exit codes

- `0` — all 8 steps passed; safe to mark deploy green
- `1` — at least one step failed (printed with reason); safe to roll back
- `2` — usage error (missing argv)

### Output

```
Smoke probe → https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com
Time: 2026-07-06T03:00:00.000Z

[1/8] OK   GET .../api/health (47ms)
[2/8] OK   GET .../api/health/ready (32ms)
[3/8] OK   GET .../api/jobs (expect 401, no auth) (28ms)
[4/8] OK   GET .../api/docs (Swagger UI HTML) (61ms)
[5/8] OK   POST .../api/auth/login {} (expect 400 missing code) (44ms)
[6/8] OK   GET .../api/internal/metrics (Prometheus exposition) (38ms)
[7/8] OK   GET .../api/internal/metrics/summary (JSON) (35ms)
[8/8] OK   POST .../api/internal/client-errors {} (expect 400 validation) (47ms)

Smoke: 8/8 passed
SMOKE OK
```

On failure the same run emits `SMOKE FAILED (first failure: step N)` and
reasons for every failed step — never stops at first failure, so you see all
breakage in one shot.

## Timeout

10 seconds per step via `AbortController`. The whole run caps at ~80s in the
absolute worst case (8 sequential fails). In practice it finishes in <2s on a
healthy tunnel because every route returns in <100ms locally.

## How to add a new step

Open `scripts/smoke.js`, find the `STEPS` array, append:

```js
{
  label: `GET ${BASE}/api/resume (expect 401, no auth)`,
  run: () => probe('GET', '/api/resume', { expectStatus: 401 }),
},
```

For a richer check (status + JSON shape):

```js
{
  label: `GET ${BASE}/api/resume/sample`,
  run: () =>
    probe('GET', '/api/resume/sample', {
      headers: { Authorization: `Bearer ${SAMPLE_TOKEN}` },
      expectStatus: 200,
      validate: ({ data }) => {
        if (!data || typeof data !== 'object') return 'not JSON object';
        if (data.code !== 0) return `expected code=0, got ${data.code}`;
        if (!Array.isArray(data.data?.sections)) return 'missing sections[]';
        return true;
      },
    }),
},
```

`validate` returns `true` to pass, a `string` to fail with that reason.

The probe runs every step in order even on failure — perfect for catching
cascading breakage after a deploy.

## Extending with an auth cookie (future)

Right now smoke only checks public + auth-boundary behavior. To add a full
auth flow (login → call `/api/resume/me` with the returned `token`):

```js
const SAMPLE_AUTH = { token: null }; // mutated by step 9, read by step 10

// step 9: do login (only if a test code is configured)
{
  label: 'POST /api/auth/login (test code)',
  run: async () => {
    const code = process.env.SMOKE_TEST_CODE;
    if (!code) return { ok: true, ms: 0, skipped: true };
    const r = await probe('POST', '/api/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      expectStatus: 200,
      validate: ({ data }) => {
        if (!data?.data?.token) return 'no token in response';
        SAMPLE_AUTH.token = data.data.token;
        return true;
      },
    });
    return r;
  },
},

// step 10: hit a protected route with the token
{
  label: 'GET /api/resume/me (with auth)',
  run: () => probe('GET', '/api/resume/me', {
    headers: { Authorization: `Bearer ${SAMPLE_AUTH.token || ''}` },
    expectStatus: 200,
  }),
},
```

Run with `SMOKE_TEST_CODE=<wx-test-code> ALERT_TOKEN=<jwt-for-tests> npm run smoke`.

That transform — adding login + cookie carry — promotes this script from
liveness probe to a minimal workflow smoke. Keep both files around: this one
for fast `pm2 reload` verification, `backend/scripts/smoke-e2e.js` for the
full real-flow check.
