const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { signPayload } = require('../src/services/webhook');

test('signPayload stable', () => {
  const a = signPayload('secret', '{"a":1}');
  const b = signPayload('secret', '{"a":1}');
  assert.strictEqual(a, b);
  assert.strictEqual(a.length, 64); // hex sha256
});

test('deliver returns ok on 2xx', async () => {
  // tiny local http server that returns 200
  const srv = http.createServer((req, res) => { res.statusCode = 200; res.end('ok'); }).listen(0);
  await new Promise(r => srv.once('listening', r));
  const port = srv.address().port;
  const { deliver } = require('../src/services/webhook');
  const r = await deliver({ url: `http://127.0.0.1:${port}/`, payload: { hi: 1 }, secret: 's', attempts: 1 });
  srv.close();
  assert.strictEqual(r.ok, true);
});

test('deliver retries then gives up → dead letter insert called (mocked pool)', async () => {
  // mock pool.query; assert insert called
  const calls = [];
  const origQuery = require('../src/config/db').query;
  require('../src/config/db').query = async (sql, params) => {
    calls.push({ sql, params });
    return [[]];
  };
  const { deliver } = require('../src/services/webhook');
  const r = await deliver({ url: 'http://127.0.0.1:1/', payload: { hi: 1 }, attempts: 2 });
  require('../src/config/db').query = origQuery;
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.attempts, 2);
  assert.ok(calls.some(c => c.sql.includes('INSERT INTO alerts_dead_letter')));
});