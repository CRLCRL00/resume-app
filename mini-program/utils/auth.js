function getToken() {
  return wx.getStorageSync('token') || '';
}

function setToken(token, user) {
  wx.setStorageSync('token', token);
  if (user) wx.setStorageSync('user', user);
}

function clearToken() {
  wx.removeStorageSync('token');
  wx.removeStorageSync('user');
}

module.exports = { getToken, setToken, clearToken };