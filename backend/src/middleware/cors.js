// R56 fix: default fallback no longer references stale serveo tunnel hostname
// (fa1b04c67... from R27 era; tunnel replaced R44). Real origin is the server
// public IP; dev IDE may use that, or a serveo hostname if ops brings tunnel
// back. Set CORS_ALLOWED_ORIGINS env to override.
const DEFAULT_ORIGINS = [
  'https://servicewechat.com',
  'https://43.139.176.199',
];
const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(','))
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

module.exports = { corsMiddleware, ALLOWED_ORIGINS };