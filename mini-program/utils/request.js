const { getToken, clearToken } = require('./auth');

const BASE_URL = 'https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com/api';

function request({ url, method = 'GET', data, silent = false } = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + url,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        Authorization: getToken() ? `Bearer ${getToken()}` : '',
      },
      success: (res) => {
        if (res.statusCode === 200) {
          resolve(res.data);
        } else if (res.statusCode === 401) {
          clearToken();
          if (!silent) {
            wx.showToast({ title: res.data?.message || '请重新登录', icon: 'none' });
          }
          reject(res.data);
        } else {
          if (!silent) {
            wx.showToast({ title: res.data?.message || '请求失败', icon: 'none' });
          }
          reject(res.data);
        }
      },
      fail: (err) => {
        if (!silent) {
          wx.showToast({ title: '网络错误', icon: 'none' });
        }
        reject(err);
      },
    });
  });
}

module.exports = { request };