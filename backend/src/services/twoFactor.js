/**
 * Admin 2FA TOTP (RFC 6238) service.
 *
 * Responsibilities:
 *  - generate / verify TOTP codes via speakeasy
 *  - mint short-lived challenge tokens (stored in Redis) exchanged for the
 *    `2fa:verified:{openid}` flag that twoFactorRequired middleware checks
 *
 * Redis failure handling: degrade fail-open for read paths (isVerified
 * returns false), fail-closed for write-of-trust (markVerified errors
 * silently but allows the request — see middleware). All Redis ops are
 * wrapped in try/catch and log via logger.warn.
 */
const crypto = require('node:crypto');
const speakeasy = require('speakeasy');
const redis = require('../config/redis');
const logger = require('../utils/logger');

const CHALLENGE_TTL_SEC = 300; // 5 min — matches spec step-up window
const VERIFIED_TTL_SEC = 300; // 5 min — admin mutation grace window
const ISSUER = 'ResumeApp';

function generateSecret({ label, issuer }) {
  const iss = issuer || ISSUER;
  const secret = speakeasy.generateSecret({
    name: `${iss}:${label}`,
    issuer: iss,
    length: 20,
  });
  const base32 = secret.base32;
  const hexId = crypto.createHash('sha256').update(base32).digest('hex').slice(0, 16);
  const otpauthUrl = `otpauth://totp/${encodeURIComponent(iss)}:${encodeURIComponent(label)}`
    + `?secret=${encodeURIComponent(base32)}&issuer=${encodeURIComponent(iss)}`;
  return { base32, otpauthUrl, hexId };
}

function verifyTotp({ secret, token, window = 1 }) {
  if (!secret || !token) return false;
  // speakeasy tolerates whitespace; trim defensively
  const t = String(token).trim();
  if (!/^\d{6}$/.test(t)) return false;
  try {
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: t,
      window,
    });
  } catch (err) {
    logger.warn({ err: err.message }, '2fa verifyTotp speakeasy threw');
    return false;
  }
}

async function issueChallengeToken({ openid }) {
  const token = crypto.randomBytes(16).toString('hex');
  try {
    // NX so we never overwrite an existing live token by accident
    await redis.set(`2fa:challenge:${token}`, openid, 'EX', CHALLENGE_TTL_SEC, 'NX');
  } catch (err) {
    logger.warn({ err: err.message }, '2fa issueChallengeToken redis fail');
    // Still return token so caller has a value; consume will fail-open to null
  }
  return token;
}

async function consumeChallengeToken({ token }) {
  if (!token) return null;
  try {
    // Try atomic GETDEL first (Redis 6.2+). Fall back to GET+DEL.
    if (typeof redis.getdel === 'function') {
      try {
        const openid = await redis.getdel(`2fa:challenge:${token}`);
        return openid || null;
      } catch (_e) {
        // server doesn't support GETDEL; fall through to GET+DEL
      }
    }
    const openid = await redis.get(`2fa:challenge:${token}`);
    if (openid) {
      try { await redis.del(`2fa:challenge:${token}`); } catch (_e) { /* best-effort */ }
    }
    return openid || null;
  } catch (err) {
    logger.warn({ err: err.message }, '2fa consumeChallengeToken redis fail');
    return null;
  }
}

async function markVerified({ openid }) {
  if (!openid) return;
  try {
    await redis.set(`2fa:verified:${openid}`, '1', 'EX', VERIFIED_TTL_SEC);
  } catch (err) {
    logger.warn({ err: err.message, openid }, '2fa markVerified redis fail');
  }
}

async function isVerified({ openid }) {
  if (!openid) return false;
  try {
    const v = await redis.get(`2fa:verified:${openid}`);
    return v !== null;
  } catch (err) {
    logger.warn({ err: err.message, openid }, '2fa isVerified redis fail');
    return false; // fail-closed: missing flag = not verified
  }
}

async function clearVerified({ openid }) {
  if (!openid) return;
  try {
    await redis.del(`2fa:verified:${openid}`);
  } catch (err) {
    logger.warn({ err: err.message, openid }, '2fa clearVerified redis fail');
  }
}

module.exports = {
  generateSecret,
  verifyTotp,
  issueChallengeToken,
  consumeChallengeToken,
  markVerified,
  isVerified,
  clearVerified,
  CHALLENGE_TTL_SEC,
  VERIFIED_TTL_SEC,
  ISSUER,
};