const mockUserAuth = (req, _res, next) => {
  req.user = { userId: 123, openid: 'test_openid' };
  next();
};

const mockUserAuthFail = (_req, res) => {
  res.status(401).json({ code: 401, message: '未授权', data: null });
};

module.exports = { mockUserAuth, mockUserAuthFail };
