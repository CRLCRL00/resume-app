/**
 * R133: 任务队列工具 (MySQL 实现, 借鉴 EdgeCareer/Inngest 异步架构)
 *
 * API:
 *   - createTask(type, payload, opts) → task_id (新任务, status=pending)
 *   - getTask(taskId, userId?) → task row
 *   - pollPendingTask(type) → 取一个 pending task, mark running (worker 用)
 *   - completeTask(taskId, result) → mark done + result
 *   - failTask(taskId, error) → mark failed + 错误 (或 retry)
 *
 * 流程:
 *   1. Client POST /api/tasks (type=X, payload=Y) → createTask → return task_id
 *   2. Worker (cron 10s) pollPendingTask(X) → 跑 → completeTask 或 failTask
 *   3. Client GET /api/tasks/:id → poll status
 */

const pool = require('../config/db');

/**
 * 创建任务 (status=pending, user_id 可选)
 * @returns {Promise<number>} task_id
 */
async function createTask(type, payload, opts = {}) {
  const { userId = null, maxRetry = 3 } = opts;
  const [r] = await pool.query(
    `INSERT INTO tasks (type, status, user_id, payload, max_retry)
     VALUES (?, 'pending', ?, CAST(? AS JSON), ?)`,
    [type, userId, JSON.stringify(payload), maxRetry]
  );
  return r.insertId;
}

/**
 * 查任务 (client polling 用)
 * @returns {Promise<Object|null>}
 */
async function getTask(taskId, userId = null) {
  const where = userId ? 'WHERE id = ? AND user_id = ?' : 'WHERE id = ?';
  const params = userId ? [taskId, userId] : [taskId];
  const [rows] = await pool.query(
    `SELECT id, type, status, payload, result, error, retry_count, created_at, started_at, completed_at
     FROM tasks ${where} LIMIT 1`,
    params
  );
  return rows[0] || null;
}

/**
 * Worker: 取一个 pending task, mark running
 * R134 fix: 简化 (去掉 getConnection + transaction),避免 mysql2 pool.getConnection
 * 返回 undefined 的边界 bug
 *
 * 用乐观锁: SELECT LIMIT 1 → UPDATE WHERE status='pending' → check affectedRows
 * 如果 affectedRows=0 说明被别的 worker 抢走, 返回 null 重试
 */
async function pollPendingTask(type = null) {
  const where = type ? 'type = ? AND status = ?' : 'status = ?';
  const params = type ? [type, 'pending'] : ['pending'];
  const [rows] = await pool.query(
    `SELECT id, type, payload, retry_count, max_retry
     FROM tasks WHERE ${where}
     ORDER BY created_at ASC LIMIT 1`,
    params
  );
  if (rows.length === 0) return null;
  const task = rows[0];
  // 乐观锁: 只有 status 还是 pending 的 task 才能 mark running (防并发抢同 task)
  const [r] = await pool.query(
    `UPDATE tasks SET status = 'running', started_at = NOW()
     WHERE id = ? AND status = 'pending'`,
    [task.id]
  );
  return r.affectedRows > 0 ? task : null;
}

/**
 * 完成任务: status=done, result=...
 */
async function completeTask(taskId, result) {
  await pool.query(
    `UPDATE tasks SET status = 'done', result = CAST(? AS JSON), completed_at = NOW() WHERE id = ?`,
    [JSON.stringify(result), taskId]
  );
}

/**
 * 失败: retry_count++, < max_retry → pending, >= → failed
 */
async function failTask(taskId, error) {
  const errStr = (error instanceof Error) ? error.message : String(error);
  const [r] = await pool.query(
    `UPDATE tasks
     SET retry_count = retry_count + 1,
         status = IF(retry_count + 1 < max_retry, 'pending', 'failed'),
         error = ?,
         started_at = NULL
     WHERE id = ?`,
    [errStr.slice(0, 500), taskId]
  );
  return r.affectedRows;
}

/**
 * Worker 主循环: 每 X 秒 poll pending tasks → 跑 handler
 *
 * @param {Object} handlers - { type: async (payload) => result }
 * @param {Object} opts - { intervalMs: 10000, maxIterations: 1000 }
 */
async function runWorker(handlers, opts = {}) {
  const intervalMs = opts.intervalMs || 10000;
  const maxIterations = opts.maxIterations || Infinity;
  let iter = 0;
  const seen = new Set();  // 防重复 poll 同 task

  while (iter < maxIterations) {
    try {
      for (const type of Object.keys(handlers)) {
        if (seen.size > 100) seen.clear();  // 限制大小
        let task = await pollPendingTask(type);
        if (!task || seen.has(task.id)) continue;
        seen.add(task.id);

        try {
          const handler = handlers[type];
          const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
          const result = await handler(payload, { taskId: task.id });
          await completeTask(task.id, result);
        } catch (err) {
          await failTask(task.id, err);
        }
      }
    } catch (err) {
      console.error('[task-worker] error:', err.message);
    }
    iter++;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

module.exports = {
  createTask,
  getTask,
  pollPendingTask,
  completeTask,
  failTask,
  runWorker,
};