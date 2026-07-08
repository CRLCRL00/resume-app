const { verify, isRevoked, decode, burnFamily } = require('../services/token');
const redis = require('../config/redis');
const { AppError } = require('./errorHandler');
const securityLog = require('../services/securityLog');
const logger = require('../utils/logger');

// 用户态校验：access token 路径。
// 注意：production 登录响应现在同时返回 refreshToken（见 routes/auth.js /login）。
// 本中间件继续接受历史签发的 30d JWT（依赖 services/token.verify），保证
// 老 token / 旧测试调用 services/token.sign() 仍能通过。refresh 链由
// services/token.{signRefresh,revoke,burnFamily} 单独维护。
// Round 39: 接受两种 token 来源
// 1) Authorization: Bearer <token> — WeChat / API clients 优先
// 2) req.cookies.auth_token — 浏览器 admin panel（httpOnly，JS 拿不到）
// 优先级：header > cookie（WeChat 调用永远走 header；cookie 仅作 fallback）
function extractToken(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return { token: auth.slice(7), via: 'header' };
  }
  if (req.cookies && req.cookies.auth_token) {
    return { token: req.cookies.auth_token, via: 'cookie' };
  }
  return { token: null, via: null };
}

async function userAuth(req, res, next) {
  const { token, via } = extractToken(req);
  if (!token) {
    return next(new AppError(1002, 'missing token', 401));
  }
  try {
    const payload = verify(token);
    // jti 黑名单优先；老 token 无 jti 回退到 key 级黑名单
    const jti = payload && payload.jti;
    if (jti) {
      const revoked = await safeCheckJti(jti);
      if (revoked) return next(new AppError(1002, 'token revoked', 401));
    } else {
      const blacklisted = await safeCheckBlacklist(token);
      if (blacklisted) return next(new AppError(1002, 'token revoked', 401));
    }

    // Round 40: cookie 模式 + refresh cookie 在场 → 检查 cookie 盗用。
    // refresh jti 已被 rotation 后 revoke（黑名单），旧 cookie 再现即 theft。
    if (via === 'cookie' && req.cookies && req.cookies.refresh_token) {
      const theftResult = await checkCookieTheftRefresh(req);
      if (theftResult) {
        const family = theftResult.family;
        if (family) {
          burnFamily(family).catch((e) =>
            logger.warn({ err: e.message, family }, 'burnFamily failed during theft response'));
        }
        // 先清 cookie（Set-Cookie 头必须在 status 之前）
        res.clearCookie('auth_token', { path: '/' });
        res.clearCookie('refresh_token', { path: '/' });
        securityLog.recordSync('cookie_theft', req, {
          oldJti: theftResult.oldJti,
          family,
          path: req.path,
        });
        // 直接写 401 JSON（避免 next(err) 走 errorHandler 时被 setHeader 顺序坑）
        return res.status(401).json({ code: 1002, message: 'cookie revoked; please re-login' });
      }
    }

    req.user = payload;
    req.token = token;
    req.authVia = via; // 'header' | 'cookie' — 用于 CSRF/audit 判定
    // Round 40: ops visibility — 标记本次会话最近一次通过验证的时间
    req.sessionBumpedAt = Date.now();
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Round 40 helper: 检查 refresh cookie 的 jti 是否已在黑名单。
 * 返回 null 表示未触发 theft；返回 { oldJti, family } 表示盗用。
 * fail-open: redis 故障不阻断主流程（与 safeCheckJti 一致）。
 */
async function checkCookieTheftRefresh(req) {
  const raw = req.cookies.refresh_token;
  if (!raw) return null;
  let decoded;
  try { decoded = decode(raw); } catch (_e) { return null; }
  if (!decoded || !decoded.jti) return null;
  let revoked;
  try {
    revoked = await isRevoked(decoded.jti);
  } catch (e) {
    logger.warn({ jti: decoded.jti, err: e.message }, 'cookie theft check failed; failing open');
    return null;
  }
  if (!revoked) return null;
  return { oldJti: decoded.jti, family: decoded.family };
}

async function safeCheckJti(jti) {
  try {
    return await isRevoked(jti);
  } catch (e) {
    // Round 33 chaos follow-up #2: observability — fail-open preserved,
    // but emit a warn so operators can correlate 401 with Redis outage.
    logger.warn({ jti, err: e.message }, 'token revocation check failed; failing open');
    return false; // redis 故障 fail-open
  }
}

async function safeCheckBlacklist(token) {
  try {
    return !!(await redis.get(`jwt:blacklist:${token}`));
  } catch (_e) {
    return false; // redis 故障 fail-open
  }
}

module.exports = { userAuth };
