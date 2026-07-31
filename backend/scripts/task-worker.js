/**
 * R133: Task Worker (独立进程, PM2 跑)
 * 用法: pm2 start backend/scripts/task-worker.js --name resume-app-task-worker
 * 监听 tasks 表 pending task → 调对应 handler → 更新 status
 */

const { runWorker } = require('../src/lib/tasks');
const { diagnoseProfile, scoreProject } = require('../src/services/jobpilotAi');

// R133 fix: PM2 跑 worker 时 NODE_ENV=production, pino logger 用 pino-pretty
// 找不到 transport target, 直接 require logger 会 crash.
// 改成用 console (PM2 自身会 redirect stdout/stderr 到 log file).

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

console.log('[task-worker] start, handlers: ' + Object.keys(handlers).join(', '));

// 10s poll 一次
runWorker(handlers, { intervalMs: 10000 }).catch((err) => {
  console.error('[task-worker] fatal', err);
  process.exit(1);
});