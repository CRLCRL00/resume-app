/**
 * perf-comment.js — generate PR comment markdown from bench JSON.
 *
 * Reads the JSON array emitted by perf-bench.js (BENCH_JSON_OUTPUT=1 mode)
 * and writes a markdown table to stdout. CI captures stdout and posts via
 * marocchino/sticky-pull-request-comment@v2.
 *
 * Usage:
 *   node scripts/perf-comment.js [path-to-bench-json]   # default: backend/.bench-results.json
 *   node scripts/perf-comment.js > perf-comment.md
 *
 * Thresholds: synced with .github/workflows/perf-ci.yml (BENCH_P95_MS / BENCH_P99_MS).
 */
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_JSON = path.join(__dirname, '..', '.bench-results.json');
const P95_MS = Number(process.env.BENCH_P95_MS) || 800;
const P99_MS = Number(process.env.BENCH_P99_MS) || 1500;

function build(jsonPath) {
  const results = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const sha = (process.env.GITHUB_SHA || 'local').slice(0, 7);
  const lines = [];
  lines.push(`## Perf Bench (commit ${sha})`);
  lines.push('');
  if (!Array.isArray(results) || results.length === 0) {
    lines.push('No benchmark data.');
    lines.push('');
    lines.push(`Thresholds: p95 < ${P95_MS}ms, p99 < ${P99_MS}ms`);
    return lines.join('\n');
  }
  lines.push('| Endpoint | p50 (ms) | p95 (ms) | p99 (ms) | RPS | Err | Result |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const e of results) {
    const ok = e.result === 'ok' ? '✅' : '❌';
    const rps = Math.round(e.throughput?.avg || 0);
    lines.push(
      `| ${e.endpoint} | ${e.latency.p50} | ${e.latency.p95} | ${e.latency.p99} | ${rps} | ${e.errors || 0} | ${ok} |`
    );
  }
  lines.push('');
  lines.push(`Thresholds: p95 < ${P95_MS}ms, p99 < ${P99_MS}ms`);
  return lines.join('\n');
}

function main(inputPath) {
  // Precedence: explicit arg > env > argv[2] > default.
  const jsonPath = inputPath || process.env.PERF_COMMENT_INPUT || process.argv[2] || DEFAULT_JSON;
  console.log(build(jsonPath));
}

module.exports = main;
if (require.main === module) main();
