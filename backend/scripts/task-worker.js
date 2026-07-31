/**
 * R133: Task Worker (独立进程, PM2 跑)
 * 用法: pm2 start backend/scripts/task-worker.js --name resume-app-task-worker
 * 监听 tasks 表 pending task → 调对应 handler → 更新 status
 */

const { runWorker } = require('../src/lib/tasks');
const { diagnoseProfile, scoreProject } = require('../src/services/jobpilotAi');
const { request } = require('../src/utils/request');
const logger = require('../src/utils/logger').default || require('../src/utils/logger');

// Handlers map: task type → async (payload) => result
const handlers = {
  // ai_evaluate: 5 题画像诊断 (R-JobSearch Step 1)
  ai_evaluate: async (payload) => {
    return diagnoseProfile(payload);
  },

  // ai_project_score: 项目评分 (R-JobSearch Step 2)
  ai_project_score: async (payload) => {
    return scoreProject(payload);
  },

  // ai_assist: AI 辅助生成字段 (R114)
  ai_assist: async (payload) => {
    // 调 /api/ai/assist-field (worker 是内部调用, 走 request util)
    const res = await request({
      url: '/ai/assist-field',
      method: 'POST',
      data: payload,
      internal: true,  // 标记 worker 内调用
    });
    return res.data || res;
  },

  // verify_jobs: 批量 verify jobs (cron 跑, 暂未实现具体逻辑)
  verify_jobs: async (payload) => {
    logger.info({ payload }, '[verify_jobs] 暂未实现');
    return { status: 'skipped', reason: 'not implemented' };
  },
};

logger.info('[task-worker] start, handlers: ' + Object.keys(handlers).join(', '));

// 10s poll 一次
runWorker(handlers, { intervalMs: 10000 }).catch((err) => {
  logger.error({ err: err.message }, '[task-worker] fatal');
  process.exit(1);
});