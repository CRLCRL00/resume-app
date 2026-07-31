/**
 * R133: Tasks API (异步任务队列)
 * POST /api/tasks               创建任务 (返回 task_id)
 * GET  /api/tasks/:id           查任务状态 (client polling)
 *
 * 注: worker 端点是 /api/internal/tasks/worker (内部用)
 */

const express = require('express');
const router = express.Router();
const { createTask, getTask } = require('../lib/tasks');
const { userAuth } = require('../middleware/auth');

// POST /api/tasks — 创建任务
router.post('/', userAuth, async (req, res, next) => {
  try {
    const { type, payload } = req.body;
    if (!type || !payload) {
      return res.status(400).json({ code: 1000, message: 'type + payload 必填' });
    }
    // 校验 type (白名单)
    const ALLOWED = new Set(['ai_evaluate', 'ai_generate', 'ai_assist', 'verify_jobs']);
    if (!ALLOWED.has(type)) {
      return res.status(400).json({ code: 1000, message: `type 不支持: ${type}` });
    }
    const taskId = await createTask(type, payload, { userId: req.user?.userId || null });
    res.status(202).json({ code: 0, data: { task_id: taskId, status: 'pending' } });
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks/:id — 查任务
router.get('/:id', userAuth, async (req, res, next) => {
  try {
    const taskId = Number(req.params.id);
    if (!taskId || taskId < 1) {
      return res.status(400).json({ code: 1000, message: 'invalid task_id' });
    }
    // user_id 限制: user 只能查自己的 task
    const task = await getTask(taskId, req.user?.userId || null);
    if (!task) {
      return res.status(404).json({ code: 1004, message: 'task 不存在' });
    }
    // 格式化 payload/result (mysql2 返 JSON 字段可能是 string 或 object)
    res.json({
      code: 0,
      data: {
        id: task.id,
        type: task.type,
        status: task.status,
        retry_count: task.retry_count,
        result: typeof task.result === 'string' ? JSON.parse(task.result || 'null') : task.result,
        error: task.error,
        created_at: task.created_at,
        started_at: task.started_at,
        completed_at: task.completed_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;