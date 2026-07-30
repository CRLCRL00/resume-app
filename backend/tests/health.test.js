const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

test('GET /api/health returns enriched shape', async () => {
  const app = createApp();
  const res = await request(app).get('/api/health');
  assert.ok([200, 503].includes(res.statusCode));
  assert.ok(res.body.data.status === 'ok' || res.body.data.status === 'degraded');
  assert.equal(res.body.code, res.statusCode === 200 ? 0 : 1503);
  assert.ok(typeof res.body.data.uptime === 'number');
  assert.ok(res.body.data.nodeVersion.startsWith('v'));
  assert.ok(typeof res.body.data.env === 'string');
  assert.ok(typeof res.body.data.version === 'string');
  assert.ok(typeof res.body.data.dbPingMs === 'number');
  assert.ok(typeof res.body.data.redisPingMs === 'number');
  assert.ok(res.body.data.db);
  assert.ok(res.body.data.redis);
});

test('GET /api/health exposes redis.persistence section', async () => {
  const app = createApp();
  const res = await request(app).get('/api/health');
  assert.ok(res.body.data.redis);
  assert.ok(res.body.data.redis.persistence);
  // persistence may be 'unknown' when CONFIG GET is disabled (test env)
  assert.ok('aof' in res.body.data.redis.persistence);
  assert.ok('rdb' in res.body.data.redis.persistence);
});

test('GET /api/health/live always 200', async () => {
  const app = createApp();
  const res = await request(app).get('/api/health/live');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.code, 0);
  assert.equal(res.body.status, 'live');
  assert.ok(typeof res.body.uptime === 'number');
});

test('GET /api/health/ready returns 200 or 503 with db+redis', async () => {
  const app = createApp();
  const res = await request(app).get('/api/health/ready');
  assert.ok([200, 503].includes(res.statusCode));
  assert.ok(['ready', 'not_ready'].includes(res.body.status));
  assert.ok(['ok', 'down'].includes(res.body.db));
  assert.ok(['ok', 'down'].includes(res.body.redis));
});

// R41-Gap-14: 生产环境强制 Redis AOF = yes，违反 → 503 not_ready
test('R41-Gap-14: /api/health/ready in production with redis AOF disabled → 503 not_ready', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevRdb = require('../src/config/redis');
  // 模拟 redis 客户端支持 ping + 但 CONFIG GET appendonly 返 'no'
  const stub = {
    ping: async () => 'PONG',
    call: async (cmd, key) => {
      if (cmd === 'CONFIG' && key === 'appendonly') return ['appendonly', 'no'];
      if (cmd === 'CONFIG' && key === 'save') return ['save', ''];
      return ['', ''];
    },
  };
  process.env.NODE_ENV = 'production';
  // 替换 require cache 让健康端点拿 stub
  const cacheKey = require.resolve('../src/config/redis');
  require.cache[cacheKey] = { exports: stub };
  delete require.cache[require.resolve('../src/routes/health')];
  delete require.cache[require.resolve('../src/app')];
  try {
    const { createApp } = require('../src/app');
    const app = createApp();
    const res = await request(app).get('/api/health/ready');
    // db 也可能失败（db 仍是真的），所以 status 不一定是 'not_ready'
    // 但 presencePersistence 字段必须是 'ok' 的反向
    if (res.statusCode === 503) {
      assert.equal(res.body.status, 'not_ready');
      assert.ok(
        typeof res.body.persistence === 'object' && res.body.persistence.ok === false,
        'persistence.ok should be false'
      );
      assert.ok(typeof res.body.persistence.reason === 'string');
    } else {
      // 如果 db + redis 都 OK,那 persistence fail 应该独立报告 503
      assert.fail(`expected 503 due to AOF, got ${res.statusCode}`);
    }
  } finally {
    process.env.NODE_ENV = prevEnv;
    require.cache[cacheKey] = { exports: prevRdb };
    delete require.cache[require.resolve('../src/routes/health')];
    delete require.cache[require.resolve('../src/app')];
  }
});

test('GET /api/nonexistent returns 404', async () => {
  const app = createApp();
  const res = await request(app).get('/api/nonexistent');
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 1404);
});
