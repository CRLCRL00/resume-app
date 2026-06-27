const express = require('express');
const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth');
const testRouter = require('./routes/test');
const adminRouter = require('./routes/admin');
const resumeRouter = require('./routes/resume');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/test', testRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/resume', resumeRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };