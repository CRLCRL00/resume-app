const Sentry = require('@sentry/node');
const config = require('./config');
const logger = require('./utils/logger');

let initialized = false;
let testCapture = null; // for test injection — setTestCapture(fn) bypasses real Sentry

/**
 * Initialize Sentry when SENTRY_DSN env var is set.
 * Otherwise this is a no-op (returns false).
 *
 * Reads SENTRY_DSN from process.env directly (not the frozen config object)
 * so tests can override it via setTestCapture / process.env mutation.
 *
 * Returns true on successful init, false when DSN is missing.
 */
function initSentry() {
  const dsn = process.env.SENTRY_DSN || '';
  if (!dsn) {
    logger.info('sentry disabled (SENTRY_DSN not set)');
    return false;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.npm_package_version || 'unknown',
    // 生产环境采样 10%；开发/staging 不采样（避免噪音）
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0.0,
    beforeSend(event) {
      // PII strip: drop sensitive headers before upload
      if (event.request && event.request.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
        delete event.request.headers['x-csrf-token'];
      }
      return event;
    },
  });
  initialized = true;
  logger.info({ environment: process.env.NODE_ENV }, 'sentry initialized');
  return true;
}

function isInitialized() {
  return initialized;
}

/**
 * Capture a message via Sentry, or via test stub if injected.
 * Returns the Sentry event id (string), or null if Sentry is not initialized
 * and no test stub is set.
 */
function captureMessage(message, level = 'info', extra = {}) {
  if (typeof testCapture === 'function') {
    return testCapture(message, level, extra);
  }
  if (!initialized) return null;
  return Sentry.captureMessage(message, level, extra);
}

/**
 * Capture an exception via Sentry.
 * Returns the Sentry event id, or null if not initialized.
 */
function captureException(err, extra = {}) {
  if (typeof testCapture === 'function') {
    return testCapture(err.message || String(err), 'error', { ...extra, stack: err.stack });
  }
  if (!initialized) return null;
  return Sentry.captureException(err, extra);
}

/**
 * Test-only hook: replace the real capture function with a stub.
 * Pass `null` to clear. Tests MUST restore via `setTestCapture(null)`
 * (or rely on test isolation which clears module cache).
 */
function setTestCapture(fn) {
  testCapture = typeof fn === 'function' ? fn : null;
}

module.exports = {
  initSentry,
  isInitialized,
  captureMessage,
  captureException,
  setTestCapture,
  Sentry,
};