const { createApp } = require('./app');
const config = require('./config');
const logger = require('./utils/logger');

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'server started');
});

function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    logger.info('http server closed');
    process.exit(0);
  });
  // 10s 强制退出
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
