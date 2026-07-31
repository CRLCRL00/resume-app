/**
 * JobPilot API Routes (R-JobSearch 重构 - Step 1/2)
 *
 * 提供:
 *   POST /api/jobpilot/profile-diagnose    5 题 → 画像分类
 *   POST /api/jobpilot/project-score       项目评分
 *
 * 不需要 DB (纯逻辑 + 规则),响应快 (< 100ms)
 */

'use strict';

const express = require('express');
const router = express.Router();
const { userAuth } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { diagnoseProfile, scoreProject } = require('../services/jobpilotAi');

/**
 * POST /api/jobpilot/profile-diagnose
 * Body: { education, aiAbility, projects, target, timeline }
 */
router.post('/profile-diagnose', userAuth, async (req, res, next) => {
  try {
    const answers = req.body || {};
    // 基础校验 (至少要有 target)
    if (!answers.target) {
      throw new AppError(1000, 'target required', 400);
    }
    const result = diagnoseProfile(answers);
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

/**
 * POST /api/jobpilot/project-score
 * Body: { name, techStack, aiCollaboration, myRole, url }
 */
router.post('/project-score', userAuth, async (req, res, next) => {
  try {
    const project = req.body || {};
    if (!project.name) {
      throw new AppError(1000, 'project.name required', 400);
    }
    const result = scoreProject(project);
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

/**
 * R133: POST /api/jobpilot/project-score-async
 * 异步版本: 写 task queue → 返回 task_id (202 Accepted)
 * Client 后续 GET /api/tasks/:id poll 查 status + result
 * 借鉴 EdgeCareer/Inngest 异步任务架构
 */
router.post('/project-score-async', userAuth, async (req, res, next) => {
  try {
    const project = req.body || {};
    if (!project.name) {
      throw new AppError(1000, 'project.name required', 400);
    }
    const { createTask } = require('../lib/tasks');
    const taskId = await createTask('ai_project_score', project, {
      userId: req.user?.userId || null,
    });
    res.status(202).json({ ok: true, task_id: taskId, status: 'pending' });
  } catch (err) { next(err); }
});

module.exports = router;