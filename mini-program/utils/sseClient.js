/**
 * R76: SSE client for WeChat mini-program.
 *
 * WeChat mp has no native EventSource. SSE is implemented on top of
 * wx.request with enableChunked:true + onChunkReceived callback.
 *
 * Chunks arrive as ArrayBuffer (or string on older runtimes) — we accumulate
 * into a buffer, split on the event boundary (\n\n), parse each event, and
 * dispatch to the consumer.
 *
 * Usage:
 *   const task = sseConnect(url, {
 *     headers: { Authorization: `Bearer ${token}` },
 *     onEvent: ({ event, data }) => { ... },
 *     onError: (err) => { ... },
 *   });
 *   // later: task.abort() to close
 *
 * Reconnect: caller is responsible (call sseConnect again on close/error).
 */
'use strict';

function decodeChunk(chunk) {
  if (chunk == null) return '';
  if (typeof chunk === 'string') return chunk;
  if (chunk instanceof ArrayBuffer) {
    // UTF-8 decode without TextDecoder (mp runtime may lack it)
    const u8 = new Uint8Array(chunk);
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    try { return decodeURIComponent(escape(s)); } catch (_) { return s; }
  }
  return String(chunk);
}

function parseEvent(raw, onEvent) {
  let eventName = 'message';
  const dataLines = [];
  let hasDataField = false;
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue; // empty / SSE comment
    const ci = line.indexOf(':');
    if (ci === -1) continue;
    const field = line.slice(0, ci).trim();
    let value = line.slice(ci + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') eventName = value;
    else if (field === 'data') {
      hasDataField = true;
      dataLines.push(value);
    }
    // ignore id:, retry:, others
  }
  // SSE spec: an event with no data field is a no-op (don't dispatch).
  // Empty-string data still counts as a field present.
  if (!hasDataField) return;
  const dataStr = dataLines.join('\n');
  let data = dataStr;
  try { data = JSON.parse(dataStr); } catch (_) { /* keep as string */ }
  try { onEvent && onEvent({ event: eventName, data, raw: dataStr }); } catch (_) { /* consumer best-effort */ }
}

/**
 * Connect to an SSE endpoint.
 * @param {string} url
 * @param {Object} opts
 * @param {Object} [opts.headers]
 * @param {Function} [opts.onEvent] - ({ event, data, raw }) => void
 * @param {Function} [opts.onError] - (err) => void
 * @param {Function} [opts.onClose] - () => void
 * @param {number} [opts.timeoutMs] - 0 = no timeout (SSE is long-lived)
 * @returns {{ abort: () => void, closed: boolean }}
 */
function sseConnect(url, opts = {}) {
  const { headers = {}, onEvent, onError, onClose, timeoutMs = 0 } = opts;
  const state = { buffer: '', closed: false };
  let requestTask = null;

  try {
    requestTask = wx.request({
      url,
      method: 'GET',
      header: headers,
      enableChunked: true,
      responseType: 'text',
      timeout: timeoutMs || 600000, // mp max ~ 600s default safety; SSE should reset via noop
      success: () => { state.closed = true; onClose && onClose(); },
      fail: (err) => { state.closed = true; onError && onError(err); },
    });
  } catch (e) {
    state.closed = true;
    onError && onError(e);
    return { abort() {}, closed: true };
  }

  // onChunkReceived is a function on the request task (mp runtime ≥ 2.10.0)
  if (requestTask && typeof requestTask.onChunkReceived === 'function') {
    requestTask.onChunkReceived((res) => {
      if (state.closed) return;
      try {
        state.buffer += decodeChunk(res.data);
        let idx;
        while ((idx = state.buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = state.buffer.slice(0, idx);
          state.buffer = state.buffer.slice(idx + 2);
          parseEvent(rawEvent, onEvent);
        }
      } catch (e) {
        // best-effort: keep going on parse error
      }
    });
  } else {
    // Older runtime without chunked callback — fallback to polling complete body
    // (not really SSE, but at least doesn't crash)
    onError && onError(new Error('onChunkReceived unavailable; SSE fallback to one-shot'));
  }

  return {
    abort() {
      state.closed = true;
      try { requestTask && requestTask.abort && requestTask.abort(); } catch (_) {}
    },
    get closed() { return state.closed; },
  };
}

/**
 * R78: auto-reconnect SSE wrapper. Wraps sseConnect with exponential backoff
 * on close/error. Stops when caller calls abort() or shouldReconnect()=false.
 *
 * Usage:
 *   const conn = sseConnectWithRetry(url, {
 *     headers: {...},
 *     onEvent: (e) => ...,
 *     onStatus: (status, attempt) => { ... }, // optional
 *     backoffMs: 1000,      // initial
 *     maxBackoffMs: 30000,  // cap
 *     maxAttempts: 0,       // 0 = infinite
 *   });
 *   conn.stop();
 */
function sseConnectWithRetry(url, opts = {}) {
  const {
    backoffMs = 1000,
    maxBackoffMs = 30_000,
    maxAttempts = 0,
    shouldReconnect,
    onStatus,
    ...sseOpts
  } = opts;
  let attempt = 0;
  let stopped = false;
  let current = null;
  let reconnectTimer = null;

  function connect() {
    if (stopped) return;
    attempt += 1;
    onStatus && onStatus('connecting', attempt);
    current = sseConnect(url, {
      ...sseOpts,
      onClose: () => {
        sseOpts.onClose && sseOpts.onClose();
        if (stopped) return;
        if (shouldReconnect && !shouldReconnect()) {
          onStatus && onStatus('stopped', attempt);
          return;
        }
        if (maxAttempts > 0 && attempt >= maxAttempts) {
          onStatus && onStatus('exhausted', attempt);
          return;
        }
        scheduleReconnect();
      },
      onError: (err) => {
        sseOpts.onError && sseOpts.onError(err);
        if (stopped) return;
        if (shouldReconnect && !shouldReconnect()) {
          onStatus && onStatus('stopped', attempt);
          return;
        }
        if (maxAttempts > 0 && attempt >= maxAttempts) {
          onStatus && onStatus('exhausted', attempt);
          return;
        }
        scheduleReconnect();
      },
    });
    onStatus && onStatus('open', attempt);
  }

  function scheduleReconnect() {
    if (stopped) return;
    const delay = Math.min(maxBackoffMs, backoffMs * Math.pow(2, attempt - 1));
    onStatus && onStatus('waiting', attempt, delay);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  connect();

  return {
    stop() {
      stopped = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (current) { try { current.abort(); } catch (_) {} current = null; }
      onStatus && onStatus('stopped', attempt);
    },
    get attempt() { return attempt; },
    get stopped() { return stopped; },
  };
}

module.exports = { sseConnect, sseConnectWithRetry, parseEvent, decodeChunk };