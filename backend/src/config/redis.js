const Redis = require('ioredis');
const config = require('./index');
const logger = require('../utils/logger');

function createRedis() {
  return new Redis({
    host: config.REDIS.host,
    port: config.REDIS.port,
    password: config.REDIS.password || undefined,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

const defaultRedis = createRedis();

defaultRedis.on('error', (err) => {
  // R65: route through structured logger (was console.error — pm2 captured it
  // but it bypassed our pino format + missing service tag)
  logger.error({ component: 'redis', err: err.message }, 'redis error');
});

module.exports = defaultRedis;
module.exports.createRedis = createRedis;
