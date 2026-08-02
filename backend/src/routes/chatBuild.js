/**
 * 对话建简历路由 (R-JobPilot-v2)
 *
 * 挂载在 /api/jobpilot/v1/chat-build/*
 *
 * 提供:
 *   POST /start    创建对话会话 + 调 LLM 拿第一问
 *   POST /next     接收用户回答 + 调 LLM 拿下一问
 *   POST /complete 强制完成 + 输出简历 JSON
 *
 * 设计:
 *   - 默认导出是 router (兼容 jobpilotV1.js require)
 *   - makeChatBuildRouter(opts) factory 让测试可注入 auth middleware
 *     (避免 mock services/token.verify 的副作用)
 */

'use strict';

const express = require('express');
const { AppError } = require('../middleware/errorHandler');
const chatBuildService = require('../services/chatBuildService');

/**
 * Factory: 构造 chatBuild router
 *
 * @param {Object} [opts]
 * @param {Function} [opts.userAuthMiddleware] - 默认 require('../middleware/auth').userAuth
 * @returns {express.Router}
 */
function makeChatBuildRouter({ userAuthMiddleware } = {}) {
  const userAuth = userAuthMiddleware || require('../middleware/auth').userAuth;
  const router = express.Router();

  /**
   * POST /api/jobpilot/v1/chat-build/start
   * Body: { image: string, answers: {education, aiAbility, projects, target, timeline} }
   */
  router.post('/start', userAuth, async (req, res, next) => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'unauthorized', 401);

      const { image, answers = {} } = req.body || {};
      if (!image) throw new AppError(1000, 'image required', 400);

      const result = await chatBuildService.start({ userId, image, answers });
      res.json({ ok: true, ...result });
    } catch (err) { next(err); }
  });

  /**
   * POST /api/jobpilot/v1/chat-build/next
   * Body: { sessionId: string, userAnswer: string }
   */
  router.post('/next', userAuth, async (req, res, next) => {
    try {
      const { sessionId, userAnswer } = req.body || {};
      if (!sessionId) throw new AppError(1000, 'sessionId required', 400);
      if (!userAnswer) throw new AppError(1000, 'userAnswer required', 400);

      const result = await chatBuildService.next({ sessionId, userAnswer });
      res.json({ ok: true, ...result });
    } catch (err) { next(err); }
  });

  /**
   * POST /api/jobpilot/v1/chat-build/complete
   * Body: { sessionId: string }
   */
  router.post('/complete', userAuth, async (req, res, next) => {
    try {
      const { sessionId } = req.body || {};
      if (!sessionId) throw new AppError(1000, 'sessionId required', 400);

      const result = await chatBuildService.complete({ sessionId });
      res.json({ ok: true, ...result });
    } catch (err) { next(err); }
  });

  return router;
}

// 默认导出: 标准 router (用真实 userAuth)
module.exports = makeChatBuildRouter();
module.exports.makeChatBuildRouter = makeChatBuildRouter;