const { verify } = require('../services/token');
const { AppError } = require('./errorHandler');

function userAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return next(new AppError(1002, 'missing token', 401));
  }
  const token = auth.slice(7);
  try {
    const payload = verify(token);
    req.user = payload;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { userAuth };
