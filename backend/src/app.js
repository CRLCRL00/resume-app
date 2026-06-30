const express = require('express');
const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth');
const testRouter = require('./routes/test');
const adminRouter = require('./routes/admin');
const resumeRouter = require('./routes/resume');
const matchRouter = require('./routes/match');
const jobsRouter = require('./routes/jobs');
const legalRouter = require('./routes/legal');
const userRouter = require('./routes/user');
const helmet = require('helmet');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  // 安全头（默认配置）
  app.use(helmet({
    contentSecurityPolicy: false,                 // API 不返回 HTML
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/test', testRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/resume', resumeRouter);
  app.use('/api/match', matchRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/legal', legalRouter);
  app.use('/api/user', userRouter);
  // OpenAPI docs
  const { openapiRouter } = require('./routes/openapi');
  app.use('/api/docs', openapiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };