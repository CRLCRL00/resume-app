const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');

const storage = new AsyncLocalStorage();

function requestContextMiddleware(req, res, next) {
  const id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-Id', id);
  res.on('finish', () => {
    // no-op; just keeps context alive through lifecycle
  });
  storage.run({ requestId: id, startTime: Date.now() }, () => {
    req.requestId = id;
    next();
  });
}

function getRequestId() {
  const ctx = storage.getStore();
  return ctx?.requestId || null;
}

function getContext() {
  return storage.getStore() || null;
}

module.exports = { requestContextMiddleware, getRequestId, getContext, storage };