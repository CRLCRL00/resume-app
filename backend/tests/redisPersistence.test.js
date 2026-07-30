const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkRedisPersistence } = require('../src/db/redisCheck');

function makeStubRedis({ appendonly, save, throwErr = false }) {
  return {
    async call(cmd, sub, key) {
      if (throwErr) throw new Error('stub boom');
      if (cmd === 'CONFIG' && sub === 'GET' && key === 'appendonly') {
        return ['appendonly', appendonly];
      }
      if (cmd === 'CONFIG' && sub === 'GET' && key === 'save') {
        return ['save', save];
      }
      if (cmd === 'INFO' && sub === 'persistence') {
        return `# Persistence\r\nloading:0\r\naof_enabled:${appendonly === 'yes' ? 1 : 0}\r\nrdb_last_bgsave_status:ok\r\n`;
      }
      throw new Error(`unexpected call: ${cmd} ${sub} ${key}`);
    },
  };
}

test('checkRedisPersistence: AOF on + RDB save configured → ok:true, no warnings', async () => {
  const redis = makeStubRedis({ appendonly: 'yes', save: '900 1 300 10 60 10000' });
  const result = await checkRedisPersistence(redis);
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.persistence.aof, 'yes');
  assert.equal(result.persistence.rdb, '900 1 300 10 60 10000');
});

test('checkRedisPersistence: AOF off → warning aof_off, ok:false', async () => {
  const redis = makeStubRedis({ appendonly: 'no', save: '900 1 300 10 60 10000' });
  const result = await checkRedisPersistence(redis);
  assert.equal(result.ok, false);
  assert.ok(result.warnings.some(w => w.includes('aof_off')));
  assert.equal(result.persistence.aof, 'no');
});

test('checkRedisPersistence: RDB save empty → warning rdb_off, ok:false', async () => {
  const redis = makeStubRedis({ appendonly: 'yes', save: '' });
  const result = await checkRedisPersistence(redis);
  assert.equal(result.ok, false);
  assert.ok(result.warnings.some(w => w.includes('rdb_off')));
});

test('checkRedisPersistence: both off → both warnings', async () => {
  const redis = makeStubRedis({ appendonly: 'no', save: '' });
  const result = await checkRedisPersistence(redis);
  assert.equal(result.ok, false);
  assert.ok(result.warnings.some(w => w.includes('aof_off')));
  assert.ok(result.warnings.some(w => w.includes('rdb_off')));
});

test('checkRedisPersistence: call throws → ok:false, generic warning', async () => {
  const redis = makeStubRedis({ appendonly: 'yes', save: '900 1', throwErr: true });
  const result = await checkRedisPersistence(redis);
  assert.equal(result.ok, false);
  assert.ok(result.warnings.some(w => w.includes('redis_persistence_check_failed')));
});