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
const metricsAlertsRouter = require('./routes/metricsAlerts');
const alertWebhookRouter = require('./routes/alertWebhook');
const clientErrorsRouter = require('./routes/clientErrors');
const sentryDebugRouter = require('./routes/sentryDebug');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { corsMiddleware } = require('./middleware/cors');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { resumeLimiter, matchLimiter } = require('./middleware/rateLimit');
const { slidingRateLimitMiddleware } = require('./middleware/slidingRateLimit');
const { adminAuditMiddleware } = require('./middleware/adminAudit');
const { lockoutMiddleware } = require('./middleware/authLockout');

const { requestContextMiddleware } = require('./middleware/requestContext');
const logger = require('./utils/logger');
const pinoHttp = require('pino-http')({
  logger,
  customLogLevel: (req, res, err) => err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.socket?.remoteAddress,
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
});

function createApp() {
  const app = express();

  // 请求上下文 + 结构化日志（必须在所有其他 middleware 之前）
  app.use(requestContextMiddleware);
  app.use(pinoHttp);

  // 安全头（HSTS preload + 强化 COOP/COEP + cross-origin 资源）
  app.use(helmet({
    contentSecurityPolicy: false, // API 不返回 HTML
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    dnsPrefetchControl: { allow: false },
    xFrameOptions: { action: 'deny' },
    strictTransportSecurity: {
      maxAge: 31536000, // 1 年
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'no-referrer' },
    permittedCrossDomainPolicies: false,
    hidePoweredBy: true,
    noSniff: true,
    xssFilter: true,
  }));

  // 全局 CORS 白名单（基于 env CORS_ALLOWED_ORIGINS）
  app.use(corsMiddleware);

  // /api/internal/* 单独 raw body（HMAC 计算需要原始字节）— 必须在 json parser 前
  app.use('/api/internal/alert', alertsRouter.rawBodyMiddleware);

  app.use(express.json({ limit: '1mb' }));
  // Round 39: cookie-parser 让 userAuth 能从 req.cookies.auth_token 读 token
  // mount 在 express.json 之后、所有路由之前；helmet/cors 仍在外层处理安全头
  app.use(cookieParser());

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

  // Sliding-window 限流（Round 29 — Redis ZSET，per-IP/per-user）
  // 必须注册在 `/api/auth` 等宽匹配之前，否则会被宽匹配提前消费
  // 测试环境用 noop 避免 supertest 反复发请求触发 429
  const isTestEnv = process.env.NODE_ENV === 'test'
    || process.env.npm_lifecycle_event === 'test'
    || !!process.env.SUPERTEST_NO_RATE_LIMIT
    || /test/i.test(process.argv[1] || '');
  const noopMw = (req, res, next) => next();
  const sliding = isTestEnv
    ? () => noopMw // in test, always return a noop middleware regardless of options
    : slidingRateLimitMiddleware;
  const loginIpLimiter = sliding({
    name: 'auth-login',
    limit: 5,
    windowMs: 60_000,
    keyFn: (req) => req.ip || req.socket?.remoteAddress || 'unknown',
  });
  const refreshIpLimiter = sliding({
    name: 'auth-refresh',
    limit: 10,
    windowMs: 60_000,
    keyFn: (req) => req.ip || req.socket?.remoteAddress || 'unknown',
  });
  app.use('/api/auth/login', loginIpLimiter);
  app.use('/api/auth/refresh', refreshIpLimiter);

  app.use('/api/auth', lockoutMiddleware);
  app.use('/api/auth', authRouter);
  app.use('/api/test', testRouter);
  app.use('/api/admin', adminAuditMiddleware);
  app.use('/api/admin', adminRouter);
  // LLM 端点限流：仅作用于具体子路径
  // - 旧固定窗口（Round 19）保留：每 IP 10 min 30 req
  // - 新滑动窗口：每用户 60s 10 req，AFTER userAuth（用户级配额更精准）
  app.use('/api/resume/generate', resumeLimiter);
  app.use('/api/match/generate', matchLimiter);
  const resumeGenUserLimiter = sliding({
    name: 'resume-generate',
    limit: 10,
    windowMs: 60_000,
    keyFn: (req) => req.user?.openid || req.user?.userId || req.ip || 'unknown',
  });
  const matchGenUserLimiter = sliding({
    name: 'match-generate',
    limit: 10,
    windowMs: 60_000,
    keyFn: (req) => req.user?.openid || req.user?.userId || req.ip || 'unknown',
  });
  // 注意：userAuth 在 router 内部（POST /generate 第一段），所以这里按 IP 兜底限流，
  // 真正的 per-user 配额在路由内由 services/rateLimit.check 覆盖。两者叠加防护。
  app.use('/api/resume/generate', resumeGenUserLimiter);
  app.use('/api/match/generate', matchGenUserLimiter);
  app.use('/api/resume', resumeRouter);
  app.use('/api/match', matchRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/legal', legalRouter);
  app.use('/api/user', userRouter);
  app.use('/api/internal', alertsRouter);
  app.use('/api/internal', metricsRouter.router);
  app.use('/api/internal', metricsAlertsRouter.router);
  // Slack incoming webhook + slash-command (Round 32-F). Mounted under
  // `/api/internal/alerts` (plural) so it does not collide with the
  // existing `/api/internal/alert` (singular) route in alerts.js.
  app.use('/api/internal/alerts/webhook/slack', alertWebhookRouter.rawBodyMiddleware);
  app.use('/api/internal/alerts/webhook/slack/command', alertWebhookRouter.urlEncodedMiddleware);
  app.use('/api/internal/alerts', alertWebhookRouter);
  app.use('/api/internal', clientErrorsRouter);
  app.use('/api/internal', sentryDebugRouter);
  // OpenAPI docs
  const { openapiRouter } = require('./routes/openapi');
  app.use('/api/docs', openapiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };