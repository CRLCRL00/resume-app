const express = require('express');
const router = express.Router();
const { userAuth } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const matchService = require('../services/matchService');
const pool = require('../config/db');
const { sanitizeForLlm } = require('../utils/sanitize');
const { idempotency, idempotencyCapture, captureBody } = require('../middleware/idempotency');

async function matchHandler(req, res, next) {
  try {
    const { resume_id } = req.body;
    if (!resume_id) throw new AppError(1000, 'resume_id required', 400);

    // 先查缓存（命中不扣限流）
    const cached = await matchService.checkCache(req.user.userId, resume_id);
    if (cached) return res.json({ code: 0, data: cached });

    // 缓存未命中 → 真实 LLM
    // 在路由边界先把 user-supplied 简历正文 sanitize 一次：
    //  1. 仅在内容里发现可疑 role tag / 控制字符时回写（避免无效 UPDATE 放大）
    //  2. sanitize 后的 content_md 会被下游 service.match → matchPrompt 直接读入喂给 LLM
    const [rows] = await pool.query(
      'SELECT content_md FROM resumes WHERE id = ? AND user_id = ? LIMIT 1',
      [resume_id, req.user.userId]
    );
    if (rows.length) {
      const raw = rows[0].content_md || '';
      const cleaned = sanitizeForLlm(raw);
      if (cleaned !== raw) {
        await pool.query('UPDATE resumes SET content_md = ? WHERE id = ?', [cleaned, resume_id]);
      }
    }

    const result = await matchService.match(req.user.userId, resume_id);
    res.json({ code: 0, data: result });
  } catch (err) { next(err); }
}

router.post('/', userAuth, idempotency({ prefix: 'match' }), captureBody(), matchHandler, idempotencyCapture());

module.exports = router;
