# Perf Bench — p95/p99 Latency Baseline

> **TL;DR**: `cd backend && npm run perf:bench` boots the express app
> in-process and drives autocannon at 4 hot endpoints. Emits JSON summary
> per endpoint; exits non-zero if any p99 exceeds threshold.

## What it does

`backend/scripts/perf-bench.js` is a self-contained Node script that:

1. Stubs external services (`wechat.code2session`, `llm.chat`) via
   `require.cache` injection — same pattern as `tests/e2e/helpers/mocks.js`.
2. Bypasses rate-limit middleware (`services/rateLimit`, `middleware/slidingRateLimit`,
   `middleware/rateLimit`) via the same trick — without this, autocannon's
   concurrent connections 429-spam within the first second and we measure
   the limiter, not the route.
3. Pre-seeds 1 admin + 1 user (via `INSERT IGNORE`), logs both in to get
   JWTs, creates 1 job + 1 resume (so /api/match and /api/resume/generate
   have valid data to operate on).
4. Boots `createApp()` on `127.0.0.1:0` (random port), then runs autocannon
   against each target sequentially. Waits for each to complete before
   starting the next (no overlap, no shared connections).
5. Emits one JSON line per endpoint, then a consolidated `PERF BENCH REPORT`.
6. Cleans up: `pool.end()`, `redis.quit()`, `server.close()` in `finally`.

## Endpoints benchmarked

| Endpoint              | Method | Conn | Duration | Notes                                 |
| --------------------- | ------ | ---- | -------- | ------------------------------------- |
| `/api/health`         | GET    | 50   | 10s      | Baseline (no DB / no Redis)           |
| `/api/resume/save`    | POST   | 20   | 10s      | Minimal valid resume; user JWT        |
| `/api/resume/generate`| POST   | 5    | 10s      | Mocked LLM; user JWT                  |
| `/api/match`          | POST   | 5    | 10s      | Mocked LLM (chatJson); user JWT       |

Total wall time: ~50s + setup (~2s).

## When to run

- **Before deploy**: capture baseline on `develop`, then re-run on
  `release/` to ensure no regression snuck in.
- **After major refactor**: middleware reorder, new query, cache layer,
  dependency upgrade.
- **Capacity planning**: bump concurrency to find the saturation point.
- **NOT in CI**: this is interactive, takes ~50s, requires local Redis +
  MySQL. Optional via manual `workflow_dispatch` only.

## How to interpret p95/p99

- **p50 (median)** — typical user experience.
- **p95** — 1 in 20 users worse than this. Tail-end health check.
- **p99** — 1 in 100 users worse than this. The number we alert on.
- **max** — worst single request in the run. Often dominated by JIT
  warmup or GC pauses; ignore unless it's >10× p99.

### Threshold

Default `BENCH_P99_MS=2000` (2 seconds). Generous — this is a Node 22
single instance with mocked external services. Real prod traffic against
DeepSeek will be slower; this baseline measures *our* code, not theirs.

For tighter CI gates use `npm run perf:bench:ci` (1500ms p99, 5s per
endpoint — ~25s total). Or override directly:

```bash
BENCH_P99_MS=800 BENCH_DURATION=30 node scripts/perf-bench.js
```

Exit code is 0 if every p99 ≤ threshold, else 1. The bench still prints
the full report on failure so you can see what regressed.

## Sample output (Node 22, MySQL localhost, mock LLM)

```json
{"endpoint":"GET /api/health","latency":{"p50":23,"p95":33,"p99":36,"max":58},"throughput":{"avg":2114.6,"min":1800,"max":2664},"errors":0,"non2xx":0,"2xx":21144,"duration_s":10,"samples":21194}
{"endpoint":"POST /api/resume/save","latency":{"p50":207,"p95":275,"p99":279,"max":282},"throughput":{"avg":96.9,"min":81,"max":118},"errors":0,"non2xx":0,"2xx":969,"duration_s":10,"samples":989}
{"endpoint":"POST /api/resume/generate","latency":{"p50":2,"p95":3,"p99":4,"max":120},"throughput":{"avg":2170.91,"min":1759,"max":2669},"errors":0,"non2xx":0,"2xx":23876,"duration_s":10,"samples":23881}
{"endpoint":"POST /api/match","latency":{"p50":4,"p95":6,"p99":7,"max":10},"throughput":{"avg":1019.1,"min":924,"max":1105},"errors":0,"non2xx":0,"2xx":11210,"duration_s":10,"samples":11215}
```

`resume/save` is the slowest (transaction: UPDATE is_active, INSERT, COMMIT),
~100 req/s with p99=279ms. `health` is fastest (no DB), 2100 req/s.
`generate` is fast because LLM is mocked and the route short-circuits when
`content_md` is already populated after the first request.

## Caveats / environmental notes

- **First-run slowdown**: V8 JIT kicks in after ~50ms. The first ~50
  requests are visibly slower; ignore them in manual comparisons.
- **Mocked LLM**: real DeepSeek calls take 500-3000ms. This bench measures
  *everything else* (DB, query parsing, JSON validation, response shape).
  The `max` for `/api/match` / `/api/resume/generate` is dominated by the
  initial LLM call latency in our mock setup, which can be 0-5ms
  depending on event loop scheduling.
- **Rate-limit bypass**: the bench replaces `services/rateLimit` and
  `middleware/slidingRateLimit` and `middleware/rateLimit` with noops.
  Without this, autocannon's 5 concurrent connections trigger 429s within
  the first 100ms — we'd be measuring the limiter, not the route. If you
  want to test rate-limit behavior, comment out those three require.cache
  blocks in `perf-bench.js`.
- **Connection pinning**: all autocannon connections come from 127.0.0.1,
  so per-IP rate limits would 429-spam without the bypass described above.
- **Single instance**: this is not a cluster bench. Real prod is behind
  PM2 with N workers; multiply throughput by N for capacity estimates.
- **Auto-skip on rate limit pollution**: before seeding, the script clears
  `login:*`, `auth:*`, `match:*`, `generate:*`, `csrf:*`, `2fa:*` keys.
  This mirrors `scripts/clear-test-rate-limit.js` so reruns within the
  same hour work.

## Real-LLM mode

Mock mode hides the dominant tail latency: every `/api/resume/generate` and
`/api/match` request blocks on DeepSeek for 1-5 seconds in production, but
the mock returns in <10ms. To capture the real picture, enable real-LLM mode:

```bash
npm run perf:bench:real            # sets --real-llm flag, 30s per endpoint @ 2 conn
# or
BENCH_REAL_LLM=1 npm run perf:bench
BENCH_REAL_LLM=1 BENCH_DURATION=60 npm run perf:bench   # override duration
BENCH_REAL_LLM=1 node scripts/perf-bench.js --real-llm  # explicit CLI flag wins over env
```

Real-mode behavior changes:
- `services/llm.js` is NOT mocked; axios hits `https://api.deepseek.com/v1/chat/completions` directly.
- Concurrency drops from 5 to 2 (DeepSeek default 60 RPM ≈ 1 req/s sustained).
- Per-endpoint duration defaults to 30s (instead of 10s) so the LLM endpoints accumulate ≥5 samples even at low concurrency — enough for a meaningful p99.
- Token usage (`prompt_tokens`, `completion_tokens`, `total_tokens`) is captured per endpoint via the `llm_tokens_total{kind=...}` Prometheus counter AND returned inline in the JSON row's `tokens_per_call` field.

### Cost warning

Each real-mode bench run bills DeepSeek tokens:
- `resume/generate` ≈ 850 prompt + 220 completion = 1070 tokens/call (input ≈ 2kB, output ≈ 1kB).
- `match` (chatJson) ≈ 1200 prompt + 180 completion = 1380 tokens/call.
- At concurrency 2 × 30s ≈ 60-100 LLM calls per endpoint (LLM latency dominates autocannon throughput).
- Per run: ~$0.01-$0.05 (DeepSeek v2.5 pricing as of 2026-Q3; check `https://api-docs.deepseek.com/quick_start/pricing`).

**Do not run this in CI unattended** — set `BENCH_REAL_LLM=0` or just use
`perf:bench` (mock) for automated gates. Reserve `perf:bench:real` for
release-week manual runs and capacity planning.

### Rate limit caveat

DeepSeek free / standard tier: 60 RPM (≈1 req/s sustained). Real-mode bench
uses concurrency 2; if you bump it, you risk 429s and retried calls (which
we surface via `llm.llmCalls{status=...}`). For sustained >2 req/s, request
a quota bump via DeepSeek support.

### Sample real-mode output

```
Endpoint                    | p99 (ms) | Tokens/call (prompt/completion/total, calls)
----------------------------|----------|-------------------------------------------------
GET /api/health             |       36 | (no LLM)
POST /api/resume/save       |      279 | (no LLM)
POST /api/resume/generate   |     3200 | 850 / 220 / 1070 (3)
POST /api/match             |     4100 | 1200 / 180 / 1380 (57)
=== PERF BENCH COMPARISON (mode=real) ===
```

The `calls` count comes from `llm_request_duration_seconds{operation,model}`
histogram — it is the actual number of upstream DeepSeek requests that
hit the API, not autocannon's HTTP sample count. Cached `/resume/generate`
requests (after the first) short-circuit before the LLM and don't count.

### Programmatic API (for tests)

```js
const { runBench } = require('./scripts/perf-bench');
const result = await runBench({
  realLlm: true,
  duration: 30,
  llmConcurrency: 2,
  skipTeardown: true,           // tests reuse the pool across runs
});
// result.mode === 'real'
// result.endpoints[i].tokens_per_call = { prompt, completion, total, calls, per_call } | null
```

`backend/tests/perf-bench-real.test.js` shows the canonical usage with
`globalThis.fetch` mocked to return DeepSeek-shaped responses.

## CI integration (optional)

Not wired by default. To add as a manual gate:

```yaml
# .github/workflows/perf-bench.yml
name: perf-bench (manual)
on:
  workflow_dispatch:
jobs:
  bench:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_DATABASE: resume_app
        ports: ['3306:3306']
        options: --health-cmd="mysqladmin ping" --health-interval=5s
      redis:
        image: redis:7
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: cd backend && npm ci
      - run: cd backend && npm run db:init
      - run: cd backend && npm run perf:bench:ci
```

## Adding a new endpoint to the bench

Edit `backend/scripts/perf-bench.js`, find the `targets` array, and add:

```js
{
  name: 'POST /api/your/endpoint',
  url: `${base}/api/your/endpoint`,
  method: 'POST',
  connections: 10,           // tune for traffic profile
  headers: userHdr,          // or adminHdr — see createJob for admin example
  body: JSON.stringify({ /* minimal valid payload */ }),
},
```

Constraints to remember:
- The endpoint must NOT depend on rate-limited paths unless you bypass
  the limiters (the bench already bypasses all three rate-limit modules).
- The endpoint must work against a freshly seeded bench DB.
- If you need a fresh JWT, hit `/api/auth/login` via `login(port, code)`.
- Keep concurrency at the value you want to measure in steady state;
  brief spikes above the rate limit will saturate to 429s even with the
  bypass off.

## Files

- Script: [`backend/scripts/perf-bench.js`](../backend/scripts/perf-bench.js)
- NPM: `backend/package.json` scripts `perf:bench`, `perf:bench:ci`
- DevDep: `autocannon@^7.15.0` (added to `backend/package.json`)
- Mock helper: `backend/tests/e2e/helpers/mocks.js`