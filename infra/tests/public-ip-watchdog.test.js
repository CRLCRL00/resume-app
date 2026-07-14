/**
 * R53 — public-ip-watchdog.sh unit test
 *
 * Pure logic test (no network). Verifies script behavior:
 *   1. Bash syntax valid
 *   2. Probe failure logged + exit 1
 *   3. STATE_FILE content survives probe failure
 *   4. Script structure has the right env var names
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const os = require('node:os');

const SCRIPT = path.resolve(__dirname, '..', 'public-ip-watchdog.sh');

function runInSandbox(extraEnv, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r53-'));
  const env = {
    ...process.env,
    PATH: process.env.PATH,
    IP_STATE_FILE: path.join(dir, 'public_ip.txt'),
    IP_LOG_FILE: path.join(dir, 'public_ip.log'),
    IP_PROBE_URL_A: 'http://127.0.0.1:1/never',
    IP_PROBE_URL_B: 'http://127.0.0.1:1/never',
    ...extraEnv,
  };
  if (opts.seededIp) {
    fs.writeFileSync(env.IP_STATE_FILE, opts.seededIp);
  }
  try {
    const out = execSync(`bash ${SCRIPT}`, { env, stdio: 'pipe' });
    return { exit: 0, stdout: out.toString(), dir };
  } catch (err) {
    return {
      exit: err.status || 1,
      stdout: (err.stdout || '').toString(),
      stderr: (err.stderr || '').toString(),
      dir,
    };
  }
}

test('R53 script syntax — bash -n', () => {
  execSync(`bash -n ${SCRIPT}`, { stdio: 'pipe' });
});

test('R53 unreachable probes exit 1 and log failure', () => {
  const r = runInSandbox({}, {});
  assert.equal(r.exit, 1, 'should exit 1 when both probes fail');
  // log file should exist
  assert.ok(fs.existsSync(r.dir + '/public_ip.log'),
    'log file should be created even on failure');
});

test('R53 STATE_FILE survives probe failure (no overwrite)', () => {
  const r = runInSandbox({}, { seededIp: '43.139.176.199' });
  const state = fs.readFileSync(r.dir + '/public_ip.txt', 'utf8');
  assert.match(state, /43\.139\.176\.199/);
});

test('R53 log records failure reason', () => {
  const r = runInSandbox({}, {});
  const log = fs.readFileSync(r.dir + '/public_ip.log', 'utf8');
  assert.match(log, /probe failed/i);
});

test('R53 script exposes required env hooks', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(src, /IP_STATE_FILE/);
  assert.match(src, /IP_LOG_FILE/);
  assert.match(src, /IP_PROBE_URL/);
  // must have a regex-style validator (avoid obviously-bad IPs)
  assert.match(src, /is_valid_ipv4|^\[0-9\]|ipv4/i);
});
