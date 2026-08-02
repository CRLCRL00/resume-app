/**
 * JobPilot v1 子路由 (R-JobPilot-v2)
 *
 * 挂载在 /api/jobpilot/v1/*
 *
 * 提供:
 *   POST /chat-build/start    创建对话会话 + 第一问
 *   POST /chat-build/next     接收用户回答 + 下一问
 *   POST /chat-build/complete 强制完成 + 输出简历 JSON
 *
 * 设计: 保持 v1 子路由结构, 后续 v2 加新版本时不动 v1
 */

'use strict';

const express = require('express');
const router = express.Router();
const { userAuth } = require('../middleware/auth');

// R-JobPilot-v2: 对话建简历子路由
const chatBuildRouter = require('./chatBuild');
router.use('/chat-build', chatBuildRouter);

module.exports = router;