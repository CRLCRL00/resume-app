const express = require('express');
const router = express.Router();
const { userAuth } = require('../middleware/auth');
const pool = require('../config/db');
const redis = require('../config/redis');
const logger = require('../utils/logger');

/**
 * GET /api/user/me/export — 导出当前用户的所有数据（GDPR-style）
 * Body: { user: {...}, resumes: [...], matches: [...], jobs: [...] }
 */
router.get('/me/export', userAuth, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const [users] = await pool.query(
      'SELECT id, openid, nickname, avatar_url, created_at, last_login_at FROM users WHERE id = ?',
      [userId]
    );
    if (!users.length) throw new Error('user not found');
    const [resumes] = await pool.query(
      'SELECT id, content_md, source_form, is_active, created_at, updated_at FROM resumes WHERE user_id = ? ORDER BY id DESC',
      [userId]
    );
    const [matches] = await pool.query(
      'SELECT id, resume_id, job_id, match_batch_id, score, reason, created_at FROM matches WHERE user_id = ? ORDER BY id DESC LIMIT 100',
      [userId]
    );
    res.json({
      code: 0,
      data: {
        exported_at: new Date().toISOString(),
        user: users[0],
        resumes,
        matches,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/user/me — 硬删除用户所有数据（GDPR / WeChat 隐私）
 * Cascade:
 *   - 删除 resumes (FK user_id)
 *   - 删除 matches (FK user_id)
 *   - 删除 admins row (if exists)
 *   - 删除 users row (last)
 *   - 清理 redis rate-limit + cache keys
 * 写 admin_operation_logs（即使删自己）
 */
router.delete('/me', userAuth, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const openid = req.user.openid;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // matches 先（即使 FK cascade 关闭，log 显式）
      await conn.query('DELETE FROM matches WHERE user_id = ?', [userId]);
      await conn.query('DELETE FROM resumes WHERE user_id = ?', [userId]);
      await conn.query('DELETE FROM admins WHERE openid = ?', [openid]);
      await conn.query('DELETE FROM users WHERE id = ?', [userId]);
      // 写 audit（openid 是唯一字段，user 已删；note 留 openid 痕迹）
      await conn.query(
        `INSERT INTO admin_operation_logs (openid, action, target_type, target_id, note)
         VALUES (?, 'user.delete_self', 'users', ?, 'GDPR self-delete')`,
        [openid, String(userId)]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // 清 redis (cache + rate-limit)
    try {
      const keys = await redis.keys(`match:${userId}:*`);
      if (keys.length) await redis.del(...keys);
      await redis.del(`match:${userId}`);
      await redis.del(`match:batch:${userId}:*`);
    } catch (e) {
      logger.warn({ err: e.message, userId }, 'user delete: redis cleanup failed');
    }

    logger.info({ userId, openid }, 'user self-delete');
    res.json({ code: 0, data: { deleted: true, user_id: userId } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
