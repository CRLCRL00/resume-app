// Round 39: cookie-based auth for admin web panel.
// WeChat mini-program keeps using Authorization: Bearer (no cookies in wx.request).
// Browser-based admin panel uses httpOnly cookie so JS can't exfiltrate.
// secure flag off in dev/test (no HTTPS) — only production sets it.
const COOKIE_CONFIG = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30d, matches JWT_EXPIRES_IN
  domain: process.env.COOKIE_DOMAIN || undefined,
};

// refresh cookie: 90d (longer than access; user gets more breathing room)
const REFRESH_COOKIE_CONFIG = {
  ...COOKIE_CONFIG,
  maxAge: 90 * 24 * 60 * 60 * 1000,
};

module.exports = { COOKIE_CONFIG, REFRESH_COOKIE_CONFIG };