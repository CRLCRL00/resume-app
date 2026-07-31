/**
 * R133: Task Worker (独立进程, PM2 跑)
 * 用法: pm2 start backend/scripts/task-worker.js --name resume-app-task-worker
 * 监听 tasks 表 pending task → 调对应 handler → 更新 status
 */

/**
 * R133: Task Worker (独立进程, PM2 跑)
 * 用法: NODE_ENV=production pm2 start backend/scripts/task-worker.js --name resume-app-task-worker
 * 监听 tasks 表 pending task → 调对应 handler → 更新 status
 */

// 必须在 require 任何模块前设 NODE_ENV, 否则 logger.js (NODE_ENV=undefined → usePretty=true)
// 会触发 pino-pretty transport target 找不到 → crash → cascade 导致 require chain 失败 → routes/tasks.js 500
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { runWorker } = require('../src/lib/tasks');
const { diagnoseProfile, scoreProject } = require('../src/services/jobpilotAi');

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

  // verify_jobs: 批量 verify jobs (cron 跑, 暂未实现具体逻辑)
  verify_jobs: async (payload) => {
    console.log('[verify_jobs] 暂未实现', payload);
    return { status: 'skipped', reason: 'not implemented' };
  },
};

console.log('[task-worker] start, NODE_ENV=' + process.env.NODE_ENV + ', handlers: ' + Object.keys(handlers).join(', '));

// 10s poll 一次
runWorker(handlers, { intervalMs: 10000 }).catch((err) => {
  console.error('[task-worker] fatal', err);
  process.exit(1);
});