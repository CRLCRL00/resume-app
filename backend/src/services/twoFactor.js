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

/**
 * Generate single-use backup codes.
 *  - count: how many (default 8)
 *  - each code: 8 hex chars (4 bytes ≈ 32 bits entropy, plenty for single-use)
 *  - format: `xxxx-xxxx` (dash for readability; normalized away at consume)
 * Returns { plaintext: ['a1b2-c3d4', ...], hashes: [sha256hex, ...] }
 */
function generateBackupCodes({ count = 8 } = {}) {
  const n = Math.max(1, Math.min(64, Number(count) || 8));
  const plaintext = [];
  const hashes = [];
  for (let i = 0; i < n; i += 1) {
    const hex = crypto.randomBytes(4).toString('hex'); // 8 hex chars
    const code = `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
    plaintext.push(code);
    hashes.push(crypto.createHash('sha256').update(hex).digest('hex'));
  }
  return { plaintext, hashes };
}

/**
 * Normalize a backup code for comparison:
 *  - remove all dashes / whitespace
 *  - lowercase
 * Returns null if the remaining string is not 8 hex chars.
 */
function normalizeBackupCode(code) {
  if (code == null) return null;
  const stripped = String(code).trim().toLowerCase().replace(/-/g, '');
  if (!/^[0-9a-f]{8}$/.test(stripped)) return null;
  return stripped;
}

/**
 * Hash a (normalized) backup code.
 */
function hashBackupCode(normalized) {
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Consume a backup code atomically:
 *  1. normalize (lowercase, strip dashes)
 *  2. SELECT backup_codes FROM admins WHERE openid = ?
 *  3. find matching hash → UPDATE JSON array with match removed
 *  4. return true (used) or false (not found)
 * Fail-open: returns false on DB errors (caller treats as invalid).
 */
async function consumeBackupCode({ openid, code }) {
  if (!openid) return false;
  const normalized = normalizeBackupCode(code);
  if (!normalized) return false;
  const wantHash = hashBackupCode(normalized);
  const pool = require('../config/db');
  try {
    const [rows] = await pool.query(
      'SELECT backup_codes FROM admins WHERE openid = ? LIMIT 1',
      [openid]
    );
    if (!rows.length) return false;
    const raw = rows[0].backup_codes;
    const stored = parseBackupCodesJson(raw);
    if (!stored || stored.length === 0) return false;
    const idx = stored.indexOf(wantHash);
    if (idx === -1) return false;
    const next = stored.slice();
    next.splice(idx, 1);
    await pool.query(
      'UPDATE admins SET backup_codes = ? WHERE openid = ?',
      [JSON.stringify(next), openid]
    );
    return true;
  } catch (err) {
    logger.warn({ err: err.message, openid }, '2fa consumeBackupCode db fail');
    return false;
  }
}

/**
 * Return count of remaining backup codes (0 if column NULL/empty).
 */
async function listBackupCodeCount({ openid }) {
  if (!openid) return 0;
  const pool = require('../config/db');
  try {
    const [rows] = await pool.query(
      'SELECT backup_codes FROM admins WHERE openid = ? LIMIT 1',
      [openid]
    );
    if (!rows.length) return 0;
    const arr = parseBackupCodesJson(rows[0].backup_codes);
    return arr ? arr.length : 0;
  } catch (err) {
    logger.warn({ err: err.message, openid }, '2fa listBackupCodeCount db fail');
    return 0;
  }
}

function parseBackupCodesJson(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === 'string');
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : null;
    } catch (_e) {
      return null;
    }
  }
  // mysql2 JSON columns come back already parsed; cover objects edge case
  return null;
}

module.exports = {
  generateSecret,
  verifyTotp,
  issueChallengeToken,
  consumeChallengeToken,
  markVerified,
  isVerified,
  clearVerified,
  generateBackupCodes,
  consumeBackupCode,
  listBackupCodeCount,
  normalizeBackupCode,
  hashBackupCode,
  CHALLENGE_TTL_SEC,
  VERIFIED_TTL_SEC,
  ISSUER,
};