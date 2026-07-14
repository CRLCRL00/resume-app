const express = require('express');
const router = express.Router();
const wechatService = require('../services/wechat');
const { sign, signRefresh, verify, decode, revoke, isRevoked, rotateFamily, detectReuse, burnFamily } = require('../services/token');
const { issueCsrf } = require('../middleware/csrf');
const pool = require('../config/db');
const { AppError } = require('../middleware/errorHandler');
const rateLimit = require('../services/rateLimit');
const securityLog = require('../services/securityLog');
const { checkLockout, recordFailure, recordSuccess } = require('../middleware/authLockout');
const logger = require('../utils/logger');
const { COOKIE_CONFIG, REFRESH_COOKIE_CONFIG } = require('../config/cookie');

/**
 * Round 40 (admin panel re-attempt): given a known admin openid (dev-bypass
 * only), upsert the user row, then sign tokens and write the same response
 * shape as the normal /login. Extracted so dev-bypass and wechat paths share
 * identical post-auth behaviour (cookies, CSRF, security log).
 *
 * @param {object} args
 * @param {string} args.openid      WeChat-resolved openid OR pre-validated dev openid
 * @param {boolean} [args.bypassDev]  If true, treat as dev-bypass (skip wechat.user insert in user table)
 * @param {object} args.req         Express req (for securityLog + ip)
 * @param {object} args.res         Express res
 * @returns {Promise<void>}
 */
async function issueSession({ openid, bypassDev }, req, res) {
  let user;
  try {
    const [existing] = await pool.query(
      'SELECT id, openid, nickname, avatar_url FROM users WHERE openid = ? LIMIT 1',
      [openid]
    );
    if (existing.length) {
      user = existing[0];
      await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    } else if (bypassDev) {
      // dev-bypass: openid 已在 admins 表存在；users 表占位即可
      const [result] = await pool.query(
        'INSERT INTO users (openid, last_login_at) VALUES (?, NOW())',
        [openid]
      );
      user = { id: result.insertId, openid, nickname: null, avatar_url: null };
    } else {
      const [result] = await pool.query(
        'INSERT INTO users (openid, last_login_at) VALUES (?, NOW())',
        [openid]
      );
      user = { id: result.insertId, openid, nickname: null, avatar_url: null };
    }
  } catch (e) {
    securityLog.recordSync('login.fail', req, { reason: 'db_write_failed', msg: e.message?.slice(0, 200) });
    throw new AppError(1502, 'database unavailable', 503);
  }

  const access = sign({ userId: user.id, openid: user.openid });
  const decodedAccess = decode(access);
  const csrf = await issueCsrf(user.openid, decodedAccess.jti);
  const refreshToken = signRefresh({ userId: user.id, openid: user.openid }, user.id);
  securityLog.recordSync('login.ok', req, { userId: user.id, openid: user.openid, via: bypassDev ? 'dev-bypass' : 'wechat' });
  logger.info({ userId: user.id, openid: user.openid, via: bypassDev ? 'dev-bypass' : 'wechat' }, 'user login');

  // 浏览器 admin panel（httpOnly cookie）+ WeChat（body token）双通道
  res.cookie('auth_token', access, COOKIE_CONFIG);
  res.cookie('refresh_token', refreshToken, REFRESH_COOKIE_CONFIG);
  res.json({ code: 0, data: { token: access, refreshToken, csrfToken: csrf, user } });
}

router.post('/login', checkLockout, async (req, res, next) => {
  // IP 限流 + lockout：每 IP 5 / 15 分钟（防爆破 + 减轻 code2session）
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const rl = await rateLimit.check(`login:ip:${ip}`, 5, 15 * 60);
  if (!rl.allowed) {
    logger.warn({ ip, remaining: rl.remaining }, 'login rate-limited / lockout');
    throw new AppError(1429, '尝试过多 IP 已被锁定 15 分钟，请稍后再试', 429);
  }

  try {
    const { code } = req.body;
    if (!code) {
      securityLog.recordSync('login.fail', req, { reason: 'missing_code', ip });
      throw new AppError(1000, 'code is required', 400);
    }

    // Round 40 (admin panel re-attempt): dev-bypass 走 admins 表校验 + 跳过 wechat
    //   - 仅在 NODE_ENV !== 'production' 时生效（生产强制走 wechat）
    //   - openid 必须已在 admins 表（不允许任意 openid 登录）
    //   - 不调 wechatService.code2session（避免 dev 无 WX_APPID 跑不起来）
    //   - 走与 wechat 路径完全相同的 issueSession（cookie + JWT + CSRF）
    if (code === 'dev-bypass' && process.env.NODE_ENV !== 'production') {
      const devOpenid = (req.body && req.body.openid) || 'dev-admin';
      let adminRows;
      try {
        [adminRows] = await pool.query(
          'SELECT id, openid FROM admins WHERE openid = ?',
          [devOpenid]
        );
      } catch (e) {
        securityLog.recordSync('login.fail', req, { reason: 'db_lookup_failed_dev_bypass', ip, msg: e.message?.slice(0, 200) });
        throw new AppError(1502, 'database unavailable', 503);
      }
      if (!adminRows.length) {
        securityLog.recordSync('login.fail', req, { reason: 'dev_bypass_not_admin', openid: devOpenid, ip });
        throw new AppError(1003, 'not an admin', 403);
      }
      securityLog.recordSync('admin.dev_bypass', req, { openid: devOpenid, ip });
      await recordSuccess(req);
      await issueSession({ openid: devOpenid, bypassDev: true }, req, res);
      return;
    }

    // Round 33 chaos follow-up #3: distinguish upstream (wechat) vs own
    // (DB) failures so operators can tell which dep is down. Existing
    // AppError 1001 (invalid code/errmsg) is still a 400; only network /
    // 5xx from WeChat is mapped to 1501.
    let wx;
    try {
      wx = await wechatService.code2session(code);
    } catch (e) {
      securityLog.recordSync('login.fail', req, { reason: 'code2session_failed', ip, msg: e.message?.slice(0, 200) });
      if (e instanceof AppError) throw e;
      throw new AppError(1501, 'wechat upstream unavailable', 502);
    }

    try {
      await issueSession({ openid: wx.openid, bypassDev: false }, req, res);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw e;
    }
    await recordSuccess(req);
  } catch (err) {
    recordFailure(req).catch(() => {});
    next(err);
  }
});

/**
 * POST /api/auth/refresh — 刷新 token（旋转 + 黑名单 + family 检测）
 * Body: { refresh_token }
 * 200: { code: 0, data: { access_token, refresh_token, expires_in } }
 * 401: invalid / revoked / reused
 */
router.post('/refresh', async (req, res, next) => {
  try {
    const { refresh_token: refreshToken } = req.body || {};
    if (!refreshToken) {
      return res.status(400).json({ code: 400, message: '缺少 refresh_token' });
    }
    let decoded;
    try {
      decoded = verify(refreshToken);
    } catch (_e) {
      return res.status(401).json({ code: 401, message: 'refresh_token 无效' });
    }
    if (decoded.kind !== 'refresh') {
      return res.status(401).json({ code: 401, message: '不是 refresh token' });
    }
    if (await isRevoked(decoded.jti)) {
      return res.status(401).json({ code: 401, message: 'refresh_token 已撤销' });
    }
    if (await detectReuse(decoded.family, decoded.jti)) {
      await burnFamily(decoded.family);
      securityLog.recordSync('auth.refresh.reuse', req, { family: decoded.family, jti: decoded.jti });
      return res.status(401).json({ code: 401, message: 'refresh_token 复用检测' });
    }

    const family = decoded.family;
    await revoke(decoded.jti, 60 * 60 * 24 * 31);
    const access = sign({ userId: decoded.userId, openid: decoded.openid });
    const refresh = signRefresh({ userId: decoded.userId, openid: decoded.openid }, family);
    const newJti = decode(refresh).jti;
    await rotateFamily(decoded.jti, newJti, family);
    securityLog.recordSync('auth.refresh.ok', req, { family, userId: decoded.userId });
    // Round 39: 旋转后同步刷 cookie（轮换出的新 access 给浏览器）
    res.cookie('auth_token', access, COOKIE_CONFIG);
    res.json({ code: 0, data: { access_token: access, refresh_token: refresh, expires_in: 900 } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/logout — 撤销 access + refresh（烧家族）
 * Body: { refresh_token? }
 * Headers: Authorization: Bearer <access>?
 * 不强制 userAuth；缺任一字段静默忽略，最后返回 { code: 0 }
 */
router.post('/logout', async (req, res, next) => {
  try {
    const auth = req.headers.authorization;
    const refreshToken = req.body && req.body.refresh_token;
    if (auth && auth.startsWith('Bearer ')) {
      const d = decode(auth.slice(7));
      if (d && d.jti) await revoke(d.jti, 900);
    }
    if (refreshToken) {
      const d = decode(refreshToken);
      if (d && d.family) await burnFamily(d.family);
    }
    securityLog.recordSync('logout', req, {});
    // Round 39: 清 cookie（即便请求来自 header-only 客户端，也清；不存在则 noop）
    res.clearCookie('auth_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
    res.json({ code: 0, data: { revoked: true } });
  } catch (err) {
    next(err);
  }
});

/**
 * R50: GET/POST /api/auth/dev-bypass — 单独 dev-only endpoint
 *
 * 区别于 /login 路由里的 dev-bypass 短路（那受 NODE_ENV==='production' 强制失效）：
 * 本 endpoint 仅在 NODE_ENV !== 'production' 注册 → 让 IDE dev (43.139.176.199 + 自签 cert)
 * 在 production server 上也能跑,完全绕开 wechat code2session + IP 白名单。
 *
 * 安全：与 /login 的 dev-bypass 一致 — 仅 openid in admins 表可登录,不接受任意 openid。
 *
 * Body: { openid: 'dev-admin' }
 * 200: { code: 0, data: { token, refreshToken, csrfToken, user } }
 * 403: openid not in admins
 * 404: server is in production mode (endpoint disabled)
 */
if (process.env.NODE_ENV !== 'production') {
  router.post('/dev-bypass', async (req, res, next) => {
    try {
      const devOpenid = (req.body && req.body.openid) || 'dev-admin';
      let adminRows;
      try {
        [adminRows] = await pool.query(
          'SELECT id, openid FROM admins WHERE openid = ?',
          [devOpenid]
        );
      } catch (e) {
        throw new AppError(1502, 'database unavailable', 503);
      }
      if (!adminRows.length) {
        throw new AppError(1003, 'not an admin', 403);
      }
      securityLog.recordSync('admin.dev_bypass.endpoint', req, { openid: devOpenid });
      await issueSession({ openid: devOpenid, bypassDev: true }, req, res);
    } catch (err) {
      recordFailure(req).catch(() => {});
      next(err);
    }
  });
}

// R51: prod-safe explicit dev-bypass — 仅在 ENABLE_DEV_BYPASS=1 env 时挂载
// 不依赖于 NODE_ENV (rest prod invariant). Use case: wechat IP whitelist
// 还没加好, ops 临开 dev-bypass 调试. 用法:
//   ENABLE_DEV_BYPASS=1 pm2 restart ...  (或 sed .env + pm2 restart --update-env)
// 警告: 该 endpoint 不限制 IP 也不锁 NODE_ENV — 任何知道 endpoint 的人都能
// 拿 admin token. 仅在 trusted dev 阶段临时开, 公开前关.
if (process.env.ENABLE_DEV_BYPASS === '1') {
  router.post('/dev-bypass-active', async (req, res, next) => {
    try {
      const devOpenid = (req.body && req.body.openid) || 'dev-admin';
      const [adminRows] = await pool.query(
        'SELECT id, openid FROM admins WHERE openid = ?',
        [devOpenid]
      );
      if (!adminRows.length) {
        throw new AppError(1003, 'not an admin', 403);
      }
      securityLog.recordSync('admin.dev_bypass.active', req, { openid: devOpenid });
      await issueSession({ openid: devOpenid, bypassDev: true }, req, res);
    } catch (err) {
      next(err);
    }
  });
  logger.warn('R51 dev-bypass-active ENABLED — admin tokens can be issued without wechat.');
}

module.exports = router;
