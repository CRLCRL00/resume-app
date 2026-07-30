/**
 * Admin / JobPilot Applications — 跨用户查看所有投递状态
 *
 * 用途:
 *  - ops/HR 看用户投递漏斗 (匹配 → 投递 → 面试 → offer)
 *  - 看哪些岗位 verify_status=stale → 触发再验证
 *  - 看哪些应用 follow_up_at 已过 → 提醒用户跟进
 *
 * 路由:
 *  - GET /admin/applications                  → 列表 + 筛选 + 分页
 *  - GET /admin/applications/stats            → dashboard stats (按 status 分组 + 按 verify_status 分组)
 */
const express = require('express');
const router = express.Router();
const { userAuth } = require('../../middleware/auth');
const { adminAuth } = require('../../middleware/adminAuth');
const pool = require('../../config/db');

function parsePage(req) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 20, 100);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

router.get('/applications/stats', userAuth, adminAuth, async (req, res, next) => {
  try {
    const [byStatus] = await pool.query(
      `SELECT status, COUNT(*) AS cnt
       FROM jobpilot_applications
       WHERE deleted_at IS NULL
       GROUP BY status
       ORDER BY cnt DESC`
    );
    const [byJobVerify] = await pool.query(
      `SELECT j.verify_status, COUNT(*) AS cnt
       FROM jobpilot_applications a
       JOIN jobs j ON j.id = a.job_id
       WHERE a.deleted_at IS NULL AND j.is_deleted = 0
       GROUP BY j.verify_status
       ORDER BY cnt DESC`
    );
    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) AS total FROM jobpilot_applications WHERE deleted_at IS NULL'
    );
    const [[{ needsFollowUp }]] = await pool.query(
      `SELECT COUNT(*) AS needsFollowUp
       FROM jobpilot_applications
       WHERE deleted_at IS NULL
         AND status NOT IN ('rejected', 'withdrawn', 'offered')
         AND follow_up_at IS NOT NULL
         AND follow_up_at < NOW()`
    );
    res.json({
      code: 0,
      data: {
        total,
        needsFollowUp,
        byStatus,
        byJobVerify,
      },
    });
  } catch (e) { next(e); }
});

router.get('/applications', userAuth, adminAuth, async (req, res, next) => {
  try {
    const { page, pageSize, offset } = parsePage(req);
    const status = (req.query.status || '').toString().trim();
    const verifyStatus = (req.query.verify_status || '').toString().trim();
    const where = ['a.deleted_at IS NULL'];
    const params = [];
    if (status) { where.push('a.status = ?'); params.push(status); }
    if (verifyStatus) { where.push('j.verify_status = ?'); params.push(verifyStatus); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [items] = await pool.query(
      `SELECT a.id, a.user_id, a.job_id, a.status, a.note, a.hr_contact,
              a.applied_at, a.status_updated_at, a.follow_up_at, a.interview_at,
              j.title AS job_title, j.company, j.city,
              j.salary_min, j.salary_max,
              j.verify_status, j.verified_at
       FROM jobpilot_applications a
       JOIN jobs j ON j.id = a.job_id
       ${whereSql}
       ORDER BY a.applied_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM jobpilot_applications a
       JOIN jobs j ON j.id = a.job_id
       ${whereSql}`,
      params
    );

    res.json({ code: 0, data: { items, total, page, pageSize, status, verify_status: verifyStatus } });
  } catch (e) { next(e); }
});

module.exports = router;
