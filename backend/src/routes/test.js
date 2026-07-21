const express = require('express');
const router = express.Router();
const llmService = require('../services/llm');
const { sign } = require('../services/token');

router.get('/llm', async (req, res, next) => {
  try {
    const result = await llmService.chat(
      [{ role: 'user', content: '只回复 pong 一个词，不要任何其他内容' }],
      { maxTokens: 10, temperature: 0 }
    );
    res.json({
      code: 0,
      data: {
        reply: result.content,
        usage: result.usage,
        model: 'deepseek-chat',
      },
    });
  } catch (err) {
    next(err);
  }
});

// R93 dev-only: reissue a token for an existing user without WX code2Session.
// Used when WX-issued token has stale openid (e.g. user.id=2 has openid='Qc'
// but admins table has correct openid='Oc'). POST /api/test/dev-reissue
// with body { userId: N }. Returns { token, openid, nickname } — caller
// stores token in client storage via wx.setStorageSync('token', token).
//
// Guarded by ENABLE_DEV_ENDPOINTS=1 (off by default). NEVER set this in real
// production — anyone with the URL can mint admin tokens. For dev/staging
// environments where you need to bypass WX code2Session, set the env var.
router.post('/dev-reissue', async (req, res, next) => {
  if (process.env.ENABLE_DEV_ENDPOINTS !== '1') {
    return res.status(404).json({ code: 404, message: 'not found' });
  }
  try {
    const { userId } = req.body || {};
    if (!userId || typeof userId !== 'number') {
      return res.status(400).json({ code: 400, message: 'userId required (number)' });
    }
    const pool = require('../config/db');
    const [rows] = await pool.query(
      'SELECT id, openid, nickname FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    if (!rows.length) {
      return res.status(404).json({ code: 404, message: 'user not found' });
    }
    const user = rows[0];
    const token = sign({ userId: user.id, openid: user.openid });
    res.json({ code: 0, data: { token, openid: user.openid, nickname: user.nickname } });
  } catch (err) {
    next(err);
  }
});

// R108 dev-only: issue token by openid (no userId needed).
// Use when you only know the WX openid (typical client dev).
// POST /api/test/dev-issue with body { openid: 'oemfzxT...' }.
// Returns { token, user: { id, openid, nickname } }.
// Auto-creates user row if not exists (so any openid works).
//
// Guarded by ENABLE_DEV_ENDPOINTS=1 (off by default).
router.post('/dev-issue', async (req, res, next) => {
  if (process.env.ENABLE_DEV_ENDPOINTS !== '1') {
    return res.status(404).json({ code: 404, message: 'not found' });
  }
  try {
    const { openid } = req.body || {};
    if (!openid || typeof openid !== 'string') {
      return res.status(400).json({ code: 400, message: 'openid required (string)' });
    }
    const pool = require('../config/db');
    const [rows] = await pool.query(
      'SELECT id, openid, nickname FROM users WHERE openid = ? LIMIT 1',
      [openid]
    );
    let user;
    if (rows.length) {
      user = rows[0];
    } else {
      // Auto-create (dev only) — production should use real WX login
      const [result] = await pool.query(
        'INSERT INTO users (openid, nickname, last_login_at) VALUES (?, ?, NOW())',
        [openid, 'dev-user']
      );
      user = { id: result.insertId, openid, nickname: 'dev-user' };
    }
    const token = sign({ userId: user.id, openid: user.openid });
    res.json({ code: 0, data: { token, user } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;