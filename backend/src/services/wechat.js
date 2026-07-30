const axios = require('axios');
const config = require('../config');
const { AppError } = require('../middleware/errorHandler');

const CODE2SESSION_URL =
  'https://api.weixin.qq.com/sns/jscode2session';

/**
 * 微信 code2session：用 code 换 openid + session_key
 * @param {string} code 小程序 wx.login() 返回的 code
 * @returns {Promise<{openid: string, session_key: string, unionid?: string}>}
 */
async function code2session(code) {
  if (!code || typeof code !== 'string') {
    throw new AppError(1000, 'code is required', 400);
  }

  const url = `${CODE2SESSION_URL}?appid=${config.WX_APPID}&secret=${config.WX_SECRET}&js_code=${code}&grant_type=authorization_code`;

  const { data } = await axios.get(url, { timeout: 5000 });

  if (data.errcode) {
    throw new AppError(1001, `wechat error: ${data.errmsg}`, 400);
  }

  return {
    openid: data.openid,
    session_key: data.session_key,
    unionid: data.unionid,
  };
}

module.exports = { code2session };
