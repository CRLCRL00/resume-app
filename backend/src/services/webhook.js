const crypto = require('node:crypto');
const pool = require('../config/db');
const logger = require('../utils/logger');

function signPayload(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function deliver({ url, payload, secret = process.env.OUTBOUND_HMAC_SECRET || 'dev-outbound', attempts = 3 }) {
  let body;
  try { body = JSON.stringify(payload); }
  catch (e) { throw new Error('payload not serializable'); }
  const sig = secret ? signPayload(secret, body) : null;
  let lastStatus = null;
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sig ? { 'X-Signature': `sha256=${sig}` } : {}),
        },
        body,
        // timeout via AbortSignal (Node 18+)
        signal: AbortSignal.timeout(5000),
      });
      lastStatus = res.status;
      if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, attempt: i };
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = String(e?.message || e);
    }
    if (i < attempts) {
      const delay = 500 * Math.pow(2, i - 1);  // 0.5s, 1s, 2s
      await new Promise(r => setTimeout(r, delay));
    }
  }
  // all attempts failed → dead letter
  try {
    await pool.query(
      'INSERT INTO alerts_dead_letter (url, payload, last_status, last_error, attempts) VALUES (?, ?, ?, ?, ?)',
      [url.slice(0, 512), body, lastStatus, (lastErr || '').slice(0, 1000), attempts]
    );
  } catch (e) {
    logger.error({ url, err: e.message }, 'dead letter insert failed');
  }
  return { ok: false, status: lastStatus, error: lastErr, attempts };
}

module.exports = { deliver, signPayload };