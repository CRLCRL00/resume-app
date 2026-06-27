const express = require('express');
const router = express.Router();
const wechatService = require('../services/wechat');
const { sign } = require('../services/token');
const pool = require('../config/db');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

router.post('/login', async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) {
      throw new AppError(1000, 'code is required', 400);
    }

    const wx = await wechatService.code2session(code);

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

    logger.info({ userId: user.id, openid: user.openid }, 'user login');

    res.json({ code: 0, data: { token, user } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;