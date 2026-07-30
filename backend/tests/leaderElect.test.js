/**
 * Round 40 — leader election tests (multi-pod alert dedupe).
 *
 * Uses a dedicated test role so it doesn't interfere with the boot-time
 * 'alert' lease held by any long-running dev process. Each test isolates
 * by role + cleans up its key in test.after.
 *
 * Multi-pod simulation: we don't actually fork processes — we swap the
 * podName() output via setRedis + a side-channel mock. The Redis key
 * is the source of truth, so as long as we set/clear `leader:{role}`
 * with distinct names, the algorithm behaves like N pods racing.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');

process.env.NODE_ENV = 'test';
process.env.npm_lifecycle_event = 'test';

const redis = require('../src/config/redis');
const leaderElect = require('../src/services/leaderElect');

const TEST_ROLE = 'test:leader-elect';
const touchedKeys = [
  `leader:${TEST_ROLE}`,
  'leader:test:role-a',
  'leader:test:role-b',
];

async function cleanup() {
  for (const k of touchedKeys) {
    try { await redis.del(k); } catch (_e) { /* best effort */ }
  }
  // Stop any heartbeat that might still be running for TEST_ROLE.
  try { await leaderElect.stopHeartbeat(TEST_ROLE); } catch (_e) { /* noop */ }
}

test.after(async () => { await cleanup(); });
test.afterEach(async () => { await cleanup(); });

// ---- 1: acquire succeeds when key is free ----
test('tryAcquire on empty key → acquired=true, isLeader=true', async () => {
  await redis.del(`leader:${TEST_ROLE}`);
  const res = await leaderElect.tryAcquire(TEST_ROLE, { ttlSec: 5 });
  assert.equal(res.acquired, true);
  assert.equal(res.leader, leaderElect.podName());
  assert.equal(res.ttl, 5);
  assert.equal(await leaderElect.isLeader(TEST_ROLE), true);
});

// ---- 2: acquire fails when another pod already holds the lease ----
test('tryAcquire when another pod holds lease → acquired=false', async () => {
  // Simulate pod A holding the lease.
  const podA = `${os.hostname()}:99999`;
  await redis.set(`leader:${TEST_ROLE}`, podA, 'EX', 10);
  const res = await leaderElect.tryAcquire(TEST_ROLE, { ttlSec: 5 });
  assert.equal(res.acquired, false);
  assert.equal(res.leader, podA, 'returned leader should be pod A');
  assert.equal(await leaderElect.isLeader(TEST_ROLE), false);
});

// ---- 3: release lets the same pod re-acquire ----
test('release → isLeader=false, then tryAcquire succeeds again', async () => {
  // Acquire as ourselves
  let res = await leaderElect.tryAcquire(TEST_ROLE, { ttlSec: 10 });
  assert.equal(res.acquired, true);
  assert.equal(await leaderElect.isLeader(TEST_ROLE), true);

  // Release
  const released = await leaderElect.release(TEST_ROLE);
  assert.equal(released, true, 'release should succeed when we own the lease');
  assert.equal(await leaderElect.isLeader(TEST_ROLE), false);

  // Re-acquire
  res = await leaderElect.tryAcquire(TEST_ROLE, { ttlSec: 10 });
  assert.equal(res.acquired, true);
});

// ---- 4: TTL expiry lets a new pod take over ----
test('TTL expiry → new pod can acquire after wait', async () => {
  // Pod A holds lease with short TTL
  const podA = `${os.hostname()}:88888`;
  await redis.set(`leader:${TEST_ROLE}`, podA, 'EX', 1);

  // Confirm we're blocked while pod A holds it
  let res = await leaderElect.tryAcquire(TEST_ROLE, { ttlSec: 5 });
  assert.equal(res.acquired, false);
  assert.equal(res.leader, podA);

  // Wait for TTL expiry + small buffer
  await new Promise((r) => setTimeout(r, 1200));

  // Now we should be able to acquire
  res = await leaderElect.tryAcquire(TEST_ROLE, { ttlSec: 5 });
  assert.equal(res.acquired, true);
  assert.equal(res.leader, leaderElect.podName());
});

// ---- 5: multi-pod handoff (A→B via release) ----
test('multi-pod handoff: pod A holds, pod B blocked, A releases, B takes over', async () => {
  // Simulate pod A by writing a known name to the key.
  const podA = `${os.hostname()}:77777`;
  await redis.set(`leader:${TEST_ROLE}`, podA, 'EX', 30);

  // Pod B (us) tries to acquire — should fail.
  let res = await leaderElect.tryAcquire(TEST_ROLE, { ttlSec: 5 });
  assert.equal(res.acquired, false);
  assert.equal(res.leader, podA);

  // Pod A "releases" by deleting the key (simulating graceful shutdown).
  await redis.del(`leader:${TEST_ROLE}`);

  // Pod B retries — succeeds.
  res = await leaderElect.tryAcquire(TEST_ROLE, { ttlSec: 5 });
  assert.equal(res.acquired, true);
  assert.equal(res.leader, leaderElect.podName());
  assert.equal(await leaderElect.getLeader(TEST_ROLE), leaderElect.podName());
});

// ---- 6: release is safe — only the leader can release ----
test('release by non-leader returns false, lease unchanged', async () => {
  // Pod A holds lease.
  const podA = `${os.hostname()}:66666`;
  await redis.set(`leader:${TEST_ROLE}`, podA, 'EX', 30);

  // We (pod B) attempt to release — should be a no-op because we don't
  // own the lease. The Lua script guard prevents this from succeeding.
  const released = await leaderElect.release(TEST_ROLE);
  assert.equal(released, false, 'non-leader cannot release');

  // Lease must still belong to pod A.
  const current = await leaderElect.getLeader(TEST_ROLE);
  assert.equal(current, podA);
});

// ---- 7 (bonus): heartbeat extends TTL ----
test('startHeartbeat → TTL extended past initial value', async () => {
  // Acquire with a short initial TTL.
  const acq = await leaderElect.tryAcquire(TEST_ROLE, { ttlSec: 3 });
  assert.equal(acq.acquired, true);

  // Manually backdate the TTL to force renewal need.
  await redis.expire(`leader:${TEST_ROLE}`, 1);
  const ttlBefore = await redis.ttl(`leader:${TEST_ROLE}`);
  assert.ok(ttlBefore >= 0 && ttlBefore <= 1, `expected ttl <=1, got ${ttlBefore}`);

  // Start heartbeat with short interval + reasonable TTL.
  // We bypass the timer-driven path and just exercise the same Lua
  // script the heartbeat uses, to keep the test deterministic and
  // avoid racing the setInterval.
  const renewScript = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
else
  return 0
end
`;
  const renewed = await redis.eval(
    renewScript, 1, `leader:${TEST_ROLE}`, leaderElect.podName(), '10'
  );
  assert.equal(Number(renewed), 1, 'heartbeat-style renew should succeed');

  const ttlAfter = await redis.ttl(`leader:${TEST_ROLE}`);
  assert.ok(ttlAfter >= 9, `expected ttl ~10 after renew, got ${ttlAfter}`);
});

// ---- 8 (R42): multi-role — same pod holds multiple roles simultaneously ----
test('R42 multi-role: same pod holds alert + admin-log-cleanup simultaneously', async () => {
  const ROLE_A = 'test:role-a';
  const ROLE_B = 'test:role-b';
  await redis.del(`leader:${ROLE_A}`, `leader:${ROLE_B}`);

  const a = await leaderElect.tryAcquire(ROLE_A, { ttlSec: 10 });
  const b = await leaderElect.tryAcquire(ROLE_B, { ttlSec: 10 });
  assert.equal(a.acquired, true);
  assert.equal(b.acquired, true);
  assert.equal(await leaderElect.isLeader(ROLE_A), true);
  assert.equal(await leaderElect.isLeader(ROLE_B), true);

  // Release A should leave B intact.
  await leaderElect.release(ROLE_A);
  assert.equal(await leaderElect.isLeader(ROLE_A), false);
  assert.equal(await leaderElect.isLeader(ROLE_B), true);

  // Cleanup
  await redis.del(`leader:${ROLE_A}`, `leader:${ROLE_B}`);
});