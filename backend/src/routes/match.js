const express = require('express');
const router = express.Router();
const { userAuth } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const matchService = require('../services/matchService');

router.post('/', userAuth, async (req, res, next) => {
  try {
    const { resume_id } = req.body;
    if (!resume_id) throw new AppError(1000, 'resume_id required', 400);

    // 先查缓存（命中不扣限流）
    const cached = await matchService.checkCache(req.user.userId, resume_id);
    if (cached) return res.json({ code: 0, data: cached });

    // 缓存未命中 → 真实 LLM
    const result = await matchService.match(req.user.userId, resume_id);
    res.json({ code: 0, data: result });
  } catch (err) { next(err); }
});

module.exports = router;