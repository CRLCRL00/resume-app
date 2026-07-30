const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { userAuth } = require('../../middleware/auth');
const { adminAuth } = require('../../middleware/adminAuth');
const { AppError } = require('../../middleware/errorHandler');
const { idempotency, idempotencyCapture } = require('../../middleware/idempotency');
const pool = require('../../config/db');
const twoFactor = require('../../services/twoFactor');

/**
 * GET /api/admin/2fa/status — 读当前 admin 2FA 状态
 * Response: { enabled:bool, hasSecret:bool, verifiedAt, backupCodesRemaining }
 */
router.get('/status', userAuth, adminAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT totp_secret, totp_enabled, totp_verified_at FROM admins WHERE openid = ? LIMIT 1',
      [req.user.openid]
    );
    if (!rows.length) throw new AppError(1003, 'admin only', 403);
    const row = rows[0];
    const backupCodesRemaining = await twoFactor.listBackupCodeCount({
      openid: req.user.openid,
    });
    res.json({
      code: 0,
      data: {
        enabled: !!row.totp_enabled,
        hasSecret: row.totp_secret != null,
        verifiedAt: row.totp_verified_at || null,
        backupCodesRemaining,
      },
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/admin/2fa/setup — 生成 secret 存 DB（不启用）
 * Response: { otpauthUrl, base32, qrDataUrl }
 */
router.post('/setup', userAuth, adminAuth, idempotency({ prefix: 'admin-2fa' }), async (req, res, next) => {
  try {
    const { base32, otpauthUrl } = twoFactor.generateSecret({
      label: req.user.openid,
      issuer: twoFactor.ISSUER,
    });
    await pool.query(
      'UPDATE admins SET totp_secret = ?, totp_enabled = 0, totp_verified_at = NULL WHERE openid = ?',
      [Buffer.from(base32, 'utf8'), req.user.openid]
    );
    let qrDataUrl = null;
    try {
      qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    } catch (_e) {
      qrDataUrl = null;
    }
    res.json({ code: 0, data: { otpauthUrl, base32, qrDataUrl } });
  } catch (err) { next(err); }
}, idempotencyCapture());

/**
 * POST /api/admin/2fa/enable — 校验 code，启用 2FA + 生成 8 backup codes
 * Body: { code }
 * Response: { enabled: true, backupCodes: ['a1b2-c3d4', ...] }
 *   backupCodes 只在此响应返回一次，admin 必须自行保存。
 */
router.post('/enable', userAuth, adminAuth, idempotency({ prefix: 'admin-2fa' }), async (req, res, next) => {
  try {
    const { code } = req.body || {};
    if (!code || !/^\d{6}$/.test(String(code))) {
      throw new AppError(1000, 'code 必须 6 位数字', 400);
    }
    const [rows] = await pool.query(
      'SELECT totp_secret FROM admins WHERE openid = ? LIMIT 1',
      [req.user.openid]
    );
    if (!rows.length || !rows[0].totp_secret) {
      throw new AppError(1000, '请先 setup', 400);
    }
    const base32 = Buffer.from(rows[0].totp_secret).toString('utf8');
    const ok = twoFactor.verifyTotp({ secret: base32, token: code });
    if (!ok) throw new AppError(1000, 'TOTP 验证码错误', 400);
    const { plaintext, hashes } = twoFactor.generateBackupCodes({ count: 8 });
    await pool.query(
      'UPDATE admins SET totp_enabled = 1, totp_verified_at = NOW(), backup_codes = ? WHERE openid = ?',
      [JSON.stringify(hashes), req.user.openid]
    );
    res.json({ code: 0, data: { enabled: true, backupCodes: plaintext } });
  } catch (err) { next(err); }
}, idempotencyCapture());

/**
 * POST /api/admin/2fa/verify — 校验 code，签发 challengeToken (5 min)
 * Body: { code }  — accepts either 6-digit TOTP or a backup code (xxxx-xxxx)
 * Response: { challengeToken }
 *
 * Round 34: 接受 backup code 作为 TOTP 的 fallback（用于 admin 丢 TOTP 设备时）。
 * Order: 6 位数字 → TOTP 校验；其它格式（hex + dash）→ backup code 校验。
 * TOTP 与 backup code 不会同时被消耗，顺序有意义。
 */
router.post('/verify', userAuth, adminAuth, idempotency({ prefix: 'admin-2fa' }), async (req, res, next) => {
  try {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string') {
      throw new AppError(1000, 'code 必填', 400);
    }
    const raw = code.trim();
    const [rows] = await pool.query(
      'SELECT totp_secret, totp_enabled FROM admins WHERE openid = ? LIMIT 1',
      [req.user.openid]
    );
    if (!rows.length || !rows[0].totp_enabled || !rows[0].totp_secret) {
      throw new AppError(1000, '2FA 未启用', 400);
    }
    const base32 = Buffer.from(rows[0].totp_secret).toString('utf8');

    // Path A: 6-digit numeric → TOTP
    if (/^\d{6}$/.test(raw)) {
      const ok = twoFactor.verifyTotp({ secret: base32, token: raw });
      if (!ok) throw new AppError(1000, 'TOTP 验证码错误', 400);
    } else {
      // Path B: backup code (xxxx-xxxx, case+dash insensitive)
      const used = await twoFactor.consumeBackupCode({
        openid: req.user.openid,
        code: raw,
      });
      if (!used) throw new AppError(1000, '验证码错误', 400);
    }

    const challengeToken = await twoFactor.issueChallengeToken({ openid: req.user.openid });
    res.json({ code: 0, data: { challengeToken } });
  } catch (err) { next(err); }
}, idempotencyCapture());

/**
 * DELETE /api/admin/2fa — 校验 code，关闭 2FA 并清空 secret
 * Body: { code }
 */
router.delete('/', userAuth, adminAuth, idempotency({ prefix: 'admin-2fa' }), async (req, res, next) => { /* delete 2fa */
  try {
    const { code } = req.body || {};
    if (!code || !/^\d{6}$/.test(String(code))) {
      throw new AppError(1000, 'code 必须 6 位数字', 400);
    }
    const [rows] = await pool.query(
      'SELECT totp_secret, totp_enabled FROM admins WHERE openid = ? LIMIT 1',
      [req.user.openid]
    );
    if (!rows.length || !rows[0].totp_enabled || !rows[0].totp_secret) {
      throw new AppError(1000, '2FA 未启用', 400);
    }
    const base32 = Buffer.from(rows[0].totp_secret).toString('utf8');
    const ok = twoFactor.verifyTotp({ secret: base32, token: code });
    if (!ok) throw new AppError(1000, 'TOTP 验证码错误', 400);
    await pool.query(
      'UPDATE admins SET totp_enabled = 0, totp_secret = NULL, totp_verified_at = NULL WHERE openid = ?',
      [req.user.openid]
    );
    await twoFactor.clearVerified({ openid: req.user.openid });
    res.json({ code: 0, data: { disabled: true } });
  } catch (err) { next(err); }
}, idempotencyCapture());

module.exports = router;