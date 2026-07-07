const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { userAuth } = require('../../middleware/auth');
const { adminAuth } = require('../../middleware/adminAuth');
const { AppError } = require('../../middleware/errorHandler');
const pool = require('../../config/db');
const twoFactor = require('../../services/twoFactor');

/**
 * GET /api/admin/2fa/status — 读当前 admin 2FA 状态
 * Response: { enabled:bool, hasSecret:bool, verifiedAt }
 */
router.get('/status', userAuth, adminAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT totp_secret, totp_enabled, totp_verified_at FROM admins WHERE openid = ? LIMIT 1',
      [req.user.openid]
    );
    if (!rows.length) throw new AppError(1003, 'admin only', 403);
    const row = rows[0];
    res.json({
      code: 0,
      data: {
        enabled: !!row.totp_enabled,
        hasSecret: row.totp_secret != null,
        verifiedAt: row.totp_verified_at || null,
      },
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/admin/2fa/setup — 生成 secret 存 DB（不启用）
 * Response: { otpauthUrl, base32, qrDataUrl }
 */
router.post('/setup', userAuth, adminAuth, async (req, res, next) => {
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
});

/**
 * POST /api/admin/2fa/enable — 校验 code，启用 2FA
 * Body: { code }
 */
router.post('/enable', userAuth, adminAuth, async (req, res, next) => {
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
    await pool.query(
      'UPDATE admins SET totp_enabled = 1, totp_verified_at = NOW() WHERE openid = ?',
      [req.user.openid]
    );
    res.json({ code: 0, data: { enabled: true } });
  } catch (err) { next(err); }
});

/**
 * POST /api/admin/2fa/verify — 校验 code，签发 challengeToken (5 min)
 * Body: { code }
 * Response: { challengeToken }
 */
router.post('/verify', userAuth, adminAuth, async (req, res, next) => {
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
    const challengeToken = await twoFactor.issueChallengeToken({ openid: req.user.openid });
    res.json({ code: 0, data: { challengeToken } });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/admin/2fa — 校验 code，关闭 2FA 并清空 secret
 * Body: { code }
 */
router.delete('/', userAuth, adminAuth, async (req, res, next) => { /* delete 2fa */
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
});

module.exports = router;