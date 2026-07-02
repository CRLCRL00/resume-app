const express = require('express');
const router = express.Router();
const wechatService = require('../services/wechat');
const { sign, signRefresh, verify, decode, revoke, isRevoked, rotateFamily, detectReuse, burnFamily } = require('../services/token');
const { userAuth } = require('../middleware/auth');
const { issueCsrf } = require('../middleware/csrf');
const pool = require('../config/db');
const redis = require('../config/redis');
const { AppError } = require('../middleware/errorHandler');
const rateLimit = require('../services/rateLimit');
const securityLog = require('../services/securityLog');
const { checkLockout, recordFailure, recordSuccess } = require('../middleware/authLockout');
const logger = require('../utils/logger');

router.post('/login', checkLockout, async (req, res, next) => {
  // IP 限流 + lockout：每 IP 5 / 15 分钟（防爆破 + 减轻 code2session）
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const rl = await rateLimit.check(`login:ip:${ip}`, 5, 15 * 60);
  if (!rl.allowed) {
    logger.warn({ ip, remaining: rl.remaining }, 'login rate-limited / lockout');
    throw new AppError(1429, '尝试过多 IP 已被锁定 15 分钟，请稍后再试', 429);
  }

  try {
    const { code } = req.body;
    if (!code) {
      securityLog.recordSync('login.fail', req, { reason: 'missing_code', ip });
      throw new AppError(1000, 'code is required', 400);
    }

    let wx;
    try {
      wx = await wechatService.code2session(code);
    } catch (e) {
      securityLog.recordSync('login.fail', req, { reason: 'code2session_failed', ip, msg: e.message?.slice(0, 200) });
      throw e;
    }

    const [existing] = await pool.query(
      'SELECT id, openid, nickname, avatar_url FROM users WHERE openid = ? LIMIT 1',
      [wx.openid]
    );

    let user;
    if (existing.length) {
      user = existing[0];
      await pool.query(
        'UPDATE users SET last_login_at = NOW() WHERE id = ?',
        [user.id]
      );
    } else {
      const [result] = await pool.query(
        'INSERT INTO users (openid, last_login_at) VALUES (?, NOW())',
        [wx.openid]
      );
      user = { id: result.insertId, openid: wx.openid, nickname: null, avatar_url: null };
    }

    const access = sign({ userId: user.id, openid: user.openid });
    const decodedAccess = decode(access);
    const csrf = await issueCsrf(user.openid, decodedAccess.jti);
    // 签 refresh token（family 关联，便于 logout 烧链 + 复用检测）
    const refreshToken = signRefresh({ userId: user.id, openid: user.openid }, user.id);
    securityLog.recordSync('login.ok', req, { userId: user.id, openid: user.openid });
    logger.info({ userId: user.id, openid: user.openid }, 'user login');

    await recordSuccess(req);
    res.json({ code: 0, data: { token: access, refreshToken, csrfToken: csrf, user } });
  } catch (err) {
    recordFailure(req).catch(() => {});
    next(err);
  }
});

/**
 * POST /api/auth/refresh — 刷新 token（旋转 + 黑名单 + family 检测）
 * Body: { refresh_token }
 * 200: { code: 0, data: { access_token, refresh_token, expires_in } }
 * 401: invalid / revoked / reused
 */
router.post('/refresh', async (req, res, next) => {
  try {
    const { refresh_token: refreshToken } = req.body || {};
    if (!refreshToken) {
      return res.status(400).json({ code: 400, message: '缺少 refresh_token' });
    }
    let decoded;
    try {
      decoded = verify(refreshToken);
    } catch (_e) {
      return res.status(401).json({ code: 401, message: 'refresh_token 无效' });
    }
    if (decoded.kind !== 'refresh') {
      return res.status(401).json({ code: 401, message: '不是 refresh token' });
    }
    if (await isRevoked(decoded.jti)) {
      return res.status(401).json({ code: 401, message: 'refresh_token 已撤销' });
    }
    if (await detectReuse(decoded.family, decoded.jti)) {
      await burnFamily(decoded.family);
      securityLog.recordSync('auth.refresh.reuse', req, { family: decoded.family, jti: decoded.jti });
      return res.status(401).json({ code: 401, message: 'refresh_token 复用检测' });
    }

    const family = decoded.family;
    await revoke(decoded.jti, 60 * 60 * 24 * 31);
    const access = sign({ userId: decoded.userId, openid: decoded.openid });
    const refresh = signRefresh({ userId: decoded.userId, openid: decoded.openid }, family);
    const newJti = decode(refresh).jti;
    await rotateFamily(decoded.jti, newJti, family);
    securityLog.recordSync('auth.refresh.ok', req, { family, userId: decoded.userId });
    res.json({ code: 0, data: { access_token: access, refresh_token: refresh, expires_in: 900 } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/logout — 撤销 access + refresh（烧家族）
 * Body: { refresh_token? }
 * Headers: Authorization: Bearer <access>?
 * 不强制 userAuth；缺任一字段静默忽略，最后返回 { code: 0 }
 */
router.post('/logout', async (req, res, next) => {
  try {
    const auth = req.headers.authorization;
    const refreshToken = req.body && req.body.refresh_token;
    if (auth && auth.startsWith('Bearer ')) {
      const d = decode(auth.slice(7));
      if (d && d.jti) await revoke(d.jti, 900);
    }
    if (refreshToken) {
      const d = decode(refreshToken);
      if (d && d.family) await burnFamily(d.family);
    }
    securityLog.recordSync('logout', req, {});
    res.json({ code: 0, data: { revoked: true } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
