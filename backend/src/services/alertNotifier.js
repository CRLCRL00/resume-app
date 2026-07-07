/**
 * alertNotifier.js — outbound Slack notification for fired alerts.
 *
 * Round 32-F. Sends an Alertmanager-style message to a Slack incoming
 * webhook URL. Uses global fetch with an AbortController-based timeout
 * (default 5s). NEVER throws — the caller decides how to react to a
 * failure.
 *
 * Payload shape (Slack incoming webhook compatible):
 *   { channel, text, blocks?: [...] }
 *
 * We keep it minimal in v1 (channel + text only) per spec; blocks can
 * be added later without breaking the signature.
 *
 * Inject fetch for tests:
 *   alertNotifier.__setFetch((url, init) => Promise.resolve({ ok:true, status:200 }));
 */
const logger = require('../utils/logger');

const DEFAULT_TIMEOUT_MS = 5000;

function notifySlack({ webhookUrl, channel, text, blocks, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  // Lazy require so tests can override globalThis.fetch before this is called.
  // globalThis.fetch is the Node 18+ global; we don't import it eagerly.
  const doFetch = globalThis.fetch;
  if (!doFetch) {
    return Promise.resolve({ ok: false, error: 'global fetch not available' });
  }
  if (!webhookUrl) {
    return Promise.resolve({ ok: false, error: 'SLACK_WEBHOOK_URL not set' });
  }
  if (!channel) {
    return Promise.resolve({ ok: false, error: 'channel required' });
  }
  if (!text) {
    return Promise.resolve({ ok: false, error: 'text required' });
  }

  const body = { channel, text };
  if (Array.isArray(blocks) && blocks.length) body.blocks = blocks;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Number(timeoutMs) || DEFAULT_TIMEOUT_MS);

  return Promise.resolve()
    .then(() => doFetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    }))
    .then((res) => {
      clearTimeout(t);
      const status = res?.status;
      if (res && res.ok) {
        return { ok: true, status };
      }
      return { ok: false, status, error: `slack responded ${status}` };
    })
    .catch((err) => {
      clearTimeout(t);
      const reason = err?.name === 'AbortError' ? 'timeout' : (err?.message || 'fetch error');
      logger.warn({ err: reason, webhookUrl: webhookUrl.slice(0, 60) }, 'slack notify failed');
      return { ok: false, error: reason };
    });
}

module.exports = { notifySlack };