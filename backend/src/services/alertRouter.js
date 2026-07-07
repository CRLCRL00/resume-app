/**
 * alertRouter.js — Round 32-F routing layer.
 *
 * Decides WHICH fired alerts get pushed to Slack and remembers recent
 * notifications in Redis so we don't spam the channel for the same
 * firing event. Independent of the evaluator (metricsAlerts.js) so it
 * can be reused for ops manual triggers (`forceNotify`).
 *
 * Decision rules per fired alert:
 *   severity critical → notify Slack + record incident via securityLog
 *   severity warning  → notify Slack (default) unless muted
 *
 * Dedupe: Redis key `alert:notify:<name>` with TTL of `ALERT_DEDUPE_TTL_MS`
 *   (default 60min). When present, the alert is SKIPPED. We only set the
 *   key on a SUCCESSFUL notify so failures don't count toward dedupe.
 *
 * Env:
 *   SLACK_WEBHOOK_URL        (required to actually send)
 *   SLACK_DEFAULT_CHANNEL    (default '#alerts')
 *   SLACK_HMAC_SECRET        (incoming verify; outgoing is just webhook URL)
 *   ALERT_DEDUPE_TTL_MS      (default 3_600_000 = 1h)
 *   ALERT_MUTED              (CSV of alert names to suppress)
 */
const redis = require('../config/redis');
const logger = require('../utils/logger');
const config = require('../config');
const { notifySlack } = require('./alertNotifier');

const DEDUPE_PREFIX = 'alert:notify:';
const DEFAULT_DEDUPE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_CHANNEL = '#alerts';

function mutedNames() {
  const csv = process.env.ALERT_MUTED || '';
  return new Set(csv.split(',').map((s) => s.trim()).filter(Boolean));
}

function dedupeTtlMs() {
  return Number(process.env.ALERT_DEDUPE_TTL_MS) || DEFAULT_DEDUPE_TTL_MS;
}

function channel() {
  return process.env.SLACK_DEFAULT_CHANNEL || DEFAULT_CHANNEL;
}

function webhookUrl() {
  return process.env.SLACK_WEBHOOK_URL || '';
}

/** Try to acquire the dedupe lock; returns true if we should notify. */
async function shouldNotify(name) {
  const key = DEDUPE_PREFIX + name;
  const ttlSec = Math.max(1, Math.floor(dedupeTtlMs() / 1000));
  // SET ... NX EX = atomic acquire
  const res = await redis.set(key, Date.now().toString(), 'EX', ttlSec, 'NX');
  return res === 'OK';
}

/** Release dedupe (used by ops forceNotify that bypasses dedupe intentionally). */
async function clearDedupe(name) {
  try { await redis.del(DEDUPE_PREFIX + name); } catch (_e) { /* best effort */ }
}

async function safeSecurityLog(event, detail) {
  try {
    // Lazy require so test env without DB doesn't crash.
    const securityLog = require('./securityLog');
    await securityLog.record(event, null, detail);
  } catch (err) {
    logger.warn({ err: err.message, event }, 'securityLog.record failed (continuing)');
  }
}

function formatAlertMessage(alert) {
  const value = alert.value !== undefined && alert.value !== null ? `value=${alert.value}` : '';
  const threshold = alert.threshold !== undefined && alert.threshold !== null ? `threshold=${alert.threshold}` : '';
  const bits = [`[${(alert.severity || 'unknown').toUpperCase()}] ${alert.name}`];
  if (value || threshold) bits.push(`(${value}${threshold ? ', ' + threshold : ''})`);
  bits.push(`— ${alert.summary || alert.description || ''}`);
  return bits.join(' ');
}

/**
 * Evaluate a fired-alerts list and push notifications for each, respecting
 * dedupe + mute lists. Returns a summary so callers (the route handler,
 * the test) can inspect what happened.
 */
async function evaluateAndNotify({ fired = [] } = {}) {
  const muted = mutedNames();
  const notified = [];
  const skipped = [];
  const errors = [];

  const url = webhookUrl();

  for (const alert of fired) {
    if (!alert || !alert.name) continue;
    if (muted.has(alert.name)) {
      skipped.push({ name: alert.name, reason: 'muted' });
      continue;
    }
    const severity = (alert.severity || 'warning').toLowerCase();

    // dedupe gate
    let acquireOk = false;
    try { acquireOk = await shouldNotify(alert.name); }
    catch (err) {
      // Redis hiccup: fail OPEN — better to notify twice than to miss.
      logger.warn({ err: err.message, name: alert.name }, 'dedupe lookup failed, notifying anyway');
      acquireOk = true;
    }
    if (!acquireOk) {
      skipped.push({ name: alert.name, reason: 'deduped' });
      continue;
    }

    const text = formatAlertMessage(alert);
    if (!url) {
      logger.warn({ alert: alert.name, reason: 'SLACK_WEBHOOK_URL not set' }, 'would have notified');
      errors.push({ name: alert.name, reason: 'SLACK_WEBHOOK_URL not set' });
      // Release the dedupe key we just acquired so the next firing actually notifies.
      await clearDedupe(alert.name);
      continue;
    }

    let res;
    try {
      res = await notifySlack({
        webhookUrl: url,
        channel: channel(),
        text,
      });
    } catch (err) {
      res = { ok: false, error: err?.message || 'unknown' };
    }

    if (!res || !res.ok) {
      // Failed to send — release dedupe so we retry on next cycle.
      await clearDedupe(alert.name);
      errors.push({ name: alert.name, reason: res?.error || 'unknown' });
      continue;
    }

    notified.push({ name: alert.name, severity, status: res.status });

    // Critical → record an incident.
    if (severity === 'critical') {
      await safeSecurityLog('alert.notify.critical', {
        name: alert.name,
        summary: alert.summary,
        value: alert.value,
        threshold: alert.threshold,
      });
    } else {
      await safeSecurityLog('alert.notify.warning', {
        name: alert.name,
        summary: alert.summary,
        value: alert.value,
        threshold: alert.threshold,
      });
    }
  }

  return { notified, skipped, errors, checked: fired.length };
}

/**
 * Manual ops trigger — bypasses dedupe so the test endpoint and "fire now"
 * buttons always go through. Caller is responsible for auth.
 */
async function forceNotify({ name, severity = 'warning', text, channel: chanOverride } = {}) {
  if (!name || !text) {
    return { ok: false, error: 'name + text required' };
  }
  const url = webhookUrl();
  if (!url) {
    logger.warn('forceNotify skipped: SLACK_WEBHOOK_URL not set');
    return { ok: false, reason: 'SLACK_WEBHOOK_URL not set' };
  }
  const res = await notifySlack({
    webhookUrl: url,
    channel: chanOverride || channel(),
    text: `[${severity.toUpperCase()}] ${name}: ${text}`,
  });
  if (res.ok) {
    await safeSecurityLog('alert.forceNotify', { name, severity, status: res.status });
  }
  return res;
}

module.exports = {
  evaluateAndNotify,
  forceNotify,
  // exported for tests
  shouldNotify,
  clearDedupe,
  mutedNames,
  formatAlertMessage,
  DEDUPE_PREFIX,
  // re-export notifier for convenience
  notifySlack,
  config,
};