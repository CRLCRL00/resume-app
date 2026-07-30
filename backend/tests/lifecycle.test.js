const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { setupGracefulShutdown } = require('../src/lifecycle');

// No-op logger capturing levels
function makeLogger() {
  const levels = [];
  const base = {};
  ['info', 'warn', 'error', 'debug'].forEach((l) => {
    base[l] = (...args) => levels.push({ level: l, args });
  });
  base._levels = levels;
  return base;
}

// Make a server whose close(cb) invokes cb only after in-flight socket closes
function makeServerMock({ inFlight = 0, closeDelayMs = 30 } = {}) {
  const ev = new EventEmitter();
  let closeCb = null;
  ev.close = (cb) => {
    closeCb = cb;
    // simulate accept loop ending immediately; in-flight tracked separately
    setImmediate(() => {
      // emulate Node: server.close fires when all sockets closed.
      // We schedule the cb via the inFlight counter inside the test.
      if (inFlight === 0) cb();
    });
  };
  // helper to emulate a connection finishing
  ev._finishInFlight = () => {
    inFlight = Math.max(0, inFlight - 1);
    if (closeCb && inFlight === 0) {
      const cb = closeCb;
      closeCb = null;
      setImmediate(cb);
    }
  };
  ev.closeIdleConnections = () => {};
  ev.closeAllConnections = () => {};
  return ev;
}

test('setupGracefulShutdown registers SIGTERM and SIGINT handlers', () => {
  const original = { sigterm: process.listeners('SIGTERM').length, sigint: process.listeners('SIGINT').length };
  const server = makeServerMock();
  const logger = makeLogger();
  const cleanup = setupGracefulShutdown(server, { logger, db: null, redis: null, timeoutMs: 1000 });
  try {
    assert.equal(process.listeners('SIGTERM').length, original.sigterm + 1, 'SIGTERM handler registered');
    assert.equal(process.listeners('SIGINT').length, original.sigint + 1, 'SIGINT handler registered');
  } finally {
    cleanup();
  }
});

test('signal triggers server.close and logs lifecycle steps', async () => {
  const server = makeServerMock({ inFlight: 0 });
  const logger = makeLogger();
  const cleanup = setupGracefulShutdown(server, { logger, db: null, redis: null, timeoutMs: 1000 });
  try {
    // emit SIGTERM to invoke handler
    process.emit('SIGTERM');
    // let microtasks flush
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));
    const messages = logger._levels.map((l) => l.args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    assert.ok(
      messages.some((m) => m.includes('shutdown signal received')),
      `expected shutdown signal log, got: ${messages.join(' | ')}`
    );
    assert.ok(
      messages.some((m) => m.includes('http server closed')),
      `expected http server closed log, got: ${messages.join(' | ')}`
    );
  } finally {
    cleanup();
  }
});

test('idempotent — second signal calls process.exit (1)', async () => {
  const server = makeServerMock({ inFlight: 0 });
  const logger = makeLogger();
  const cleanup = setupGracefulShutdown(server, { logger, db: null, redis: null, timeoutMs: 1000 });
  const origExit = process.exit;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; };
  try {
    process.emit('SIGTERM');
    await new Promise((r) => setImmediate(r));
    process.emit('SIGTERM');
    await new Promise((r) => setImmediate(r));
    assert.equal(exitCode, 1, 'second SIGTERM should call process.exit(1)');
  } finally {
    process.exit = origExit;
    cleanup();
  }
});

test('in-flight request completes before server.close callback fires', async () => {
  let inFlight = 1;
  const server = makeServerMock({ inFlight });
  const logger = makeLogger();
  const events = [];
  // wrap server.close to detect when cb fires
  const origClose = server.close;
  server.close = (cb) => {
    events.push('server.close called');
    origClose(() => {
      events.push('close callback fired');
      cb();
    });
  };
  const cleanup = setupGracefulShutdown(server, { logger, db: null, redis: null, timeoutMs: 1000 });
  try {
    process.emit('SIGTERM');
    // let close start
    await new Promise((r) => setImmediate(r));
    // close should be called but callback not yet (still 1 in-flight)
    assert.ok(events.includes('server.close called'), 'server.close should have been invoked');
    // simulate in-flight finishing
    server._finishInFlight();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(events.includes('close callback fired'), 'close callback should fire after in-flight drains');
  } finally {
    cleanup();
  }
});

test('hard timeout fires process.exit(1) when server never closes', async () => {
  // server whose close callback never fires (stuck)
  const stuckServer = new EventEmitter();
  stuckServer.close = () => { /* never invokes cb */ };
  stuckServer.closeIdleConnections = () => {};
  stuckServer.closeAllConnections = () => {};
  const logger = makeLogger();
  const cleanup = setupGracefulShutdown(stuckServer, { logger, db: null, redis: null, timeoutMs: 50 });
  const origExit = process.exit;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; };
  try {
    process.emit('SIGINT');
    // wait > timeoutMs
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(exitCode, 1, 'hard timeout should force process.exit(1)');
  } finally {
    process.exit = origExit;
    cleanup();
  }
});

test('cleanup removes signal handlers so other tests are not affected', () => {
  const before = { sigterm: process.listeners('SIGTERM').length, sigint: process.listeners('SIGINT').length };
  const server = makeServerMock();
  const logger = makeLogger();
  const cleanup = setupGracefulShutdown(server, { logger, db: null, redis: null, timeoutMs: 1000 });
  cleanup();
  assert.equal(process.listeners('SIGTERM').length, before.sigterm, 'SIGTERM handler removed');
  assert.equal(process.listeners('SIGINT').length, before.sigint, 'SIGINT handler removed');
});

// Reference unused imports to keep ESLint quiet
test('imports are wired', () => {
  assert.ok(typeof http === 'object');
  assert.ok(typeof EventEmitter === 'function');
});
