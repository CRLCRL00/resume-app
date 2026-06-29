const Redis = require('ioredis');
const config = require('./index');

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
  // eslint-disable-next-line no-console
  console.error('[redis] error:', err.message);
});

module.exports = defaultRedis;
module.exports.createRedis = createRedis;
