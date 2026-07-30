const { test } = require('node:test');
const assert = require('node:assert/strict');
const { code2session } = require('../src/services/wechat');

test('code2session returns openid on success', async () => {
  const axios = require('axios');
  const orig = axios.get;
  axios.get = async (url) => {
    if (url.includes('/sns/jscode2session')) {
      return { data: { openid: 'mock_openid_123', session_key: 'mock_sk' } };
    }
    return orig(url);
  };

  const result = await code2session('mock_js_code');
  assert.equal(result.openid, 'mock_openid_123');
  assert.equal(result.session_key, 'mock_sk');

  axios.get = orig;
});

test('code2session throws on wechat error', async () => {
  const axios = require('axios');
  const orig = axios.get;
  axios.get = async () => ({ data: { errcode: 40029, errmsg: 'invalid code' } });

  await assert.rejects(
    () => code2session('bad_code'),
    /invalid code/
  );

  axios.get = orig;
});
