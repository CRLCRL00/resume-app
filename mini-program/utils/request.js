/**
 * request — wx.request wrapper
 * @param {Object} opts
 * @param {string} opts.url
 * @param {string} [opts.method='GET']
 * @param {Object} [opts.data]
 * @param {boolean} [opts.silent=false]   skip toast
 * @param {number}  [opts.retry=1]        GET-only retry count on network fail
 * @param {number}  [opts.retryDelayMs=300] delay between retries (ms)
 * @returns {Promise} resolves with res.data, rejects with res.data or err
 */
const { getToken, clearToken } = require('./auth');

const BASE_URL = 'https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com/api';

function fallbackByStatus(code) {
  if (code === 400) return '请求参数错误';
  if (code === 401) return '请重新登录';
  if (code === 403) return '无权限';
  if (code === 404) return '资源不存在';
  if (code === 429) return '请求过于频繁';
  if (code >= 500 && code < 600) return '服务异常，请稍后重试';
  return '请求失败';
}

function showToast(title) {
  wx.showToast({ title, icon: 'none' });
}

function doRequest(opts) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + opts.url,
      method: opts.method,
      data: opts.data,
      header: {
        'Content-Type': 'application/json',
        Authorization: getToken() ? `Bearer ${getToken()}` : '',
      },
      success: (res) => {
        if (res.statusCode === 200) {
          resolve(res.data);
        } else if (res.statusCode === 401) {
          clearToken();
          if (!opts.silent) showToast(res.data?.message || '请重新登录');
          reject(res.data);
        } else {
          if (!opts.silent) showToast(res.data?.message || fallbackByStatus(res.statusCode));
          reject(res.data);
        }
      },
      fail: (err) => {
        if (!opts.silent) {
          showToast(opts._retried ? '网络异常，已重试' : '网络错误，请检查网络');
        }
        reject(err);
      },
    });
  });
}

function request(opts = {}) {
  const { url, method = 'GET', data, silent = false, retry = 1, retryDelayMs = 300 } = opts;
  const base = { url, method, data, silent, _retried: false };
  return doRequest(base).catch((err) => {
    if (method === 'GET' && retry > 0) {
      base._retried = true;
      return new Promise((r) => setTimeout(r, retryDelayMs)).then(() =>
        doRequest(base)
      );
    }
    throw err;
  });
}

module.exports = { request };
