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
const alertsRouter = require('./routes/alerts');
const metricsRouter = require('./routes/metrics');
const helmet = require('helmet');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  // 安全头（HSTS preload + 强化 COOP/COEP + cross-origin 资源）
  app.use(helmet({
    contentSecurityPolicy: false,                 // API 不返回 HTML
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    strictTransportSecurity: {
      maxAge: 31536000,        // 1 年
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'no-referrer' },
    permittedCrossDomainPolicies: false,
    hidePoweredBy: true,
    noSniff: true,
    xssFilter: true,
  }));

  // /api/internal/* 单独 raw body（HMAC 计算需要原始字节）— 必须在 json parser 前
  app.use('/api/internal/alert', alertsRouter.rawBodyMiddleware);

  app.use(express.json({ limit: '1mb' }));

  // HTTP timing metrics（记录每个请求耗时到 Prometheus histogram）
  const m = metricsRouter;
  app.use((req, res, next) => {
    if (req.path === '/api/internal/metrics') return next();
    const t0 = Date.now();
    res.on('finish', () => {
      const dur = (Date.now() - t0) / 1000;
      // 路由高基数标签：用 req.baseUrl + route.path（无 route 时 fallback req.path）
      const labelRoute = (req.route ? req.baseUrl + req.route.path : req.baseUrl || req.path) || 'unknown';
      const status = String(res.statusCode);
      try {
        m.httpRequests.inc({ method: req.method, route: labelRoute, status });
        m.httpDuration.observe({ method: req.method, route: labelRoute, status }, dur);
        if (dur > 1) m.slowOps.inc({ route: labelRoute, op: 'slow_request' });
      } catch (_e) { /* ignore */ }
    });
    next();
  });

  // Swagger UI inline HTML 需要 inline-block 资源；个别路由开放 cross-origin
  app.use('/api/docs', (req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    next();
  });

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/test', testRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/resume', resumeRouter);
  app.use('/api/match', matchRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/legal', legalRouter);
  app.use('/api/user', userRouter);
  app.use('/api/internal', alertsRouter);
  app.use('/api/internal', metricsRouter.router);
  // OpenAPI docs
  const { openapiRouter } = require('./routes/openapi');
  app.use('/api/docs', openapiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };