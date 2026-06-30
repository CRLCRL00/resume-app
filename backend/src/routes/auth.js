const express = require('express');
const router = express.Router();
const wechatService = require('../services/wechat');
const { sign } = require('../services/token');
const pool = require('../config/db');
const { AppError } = require('../middleware/errorHandler');
const rateLimit = require('../services/rateLimit');
const securityLog = require('../services/securityLog');
const logger = require('../utils/logger');

router.post('/login', async (req, res, next) => {
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

    const token = sign({ userId: user.id, openid: user.openid });
    securityLog.recordSync('login.ok', req, { userId: user.id, openid: user.openid });
    logger.info({ userId: user.id, openid: user.openid }, 'user login');

    res.json({ code: 0, data: { token, user } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;