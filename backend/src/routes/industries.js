/**
 * R130: 行业路由 — 首页推荐用
 * GET /api/industries 返回 [{industry, job_count, recent_verified, avg_salary_max}]
 * 数据源: jobs 表 title DISTINCT + 统计 (verify_status + verified_at + salary_max)
 *
 * 注: jobs 表没有 industry 字段,用 title 作为类目。
 * 等以后 jobs 加 industry 字段后,可升级 SQL。
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

router.get('/', async (req, res, next) => {
  try {
    // 取每个 title (行业) 的统计
    // recent_verified: 最近 7 天 verify_status='verified' 且 verified_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    const [rows] = await pool.query(`
      SELECT
        title AS industry,
        COUNT(*) AS job_count,
        SUM(CASE WHEN verify_status = 'verified'
                  AND verified_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                 THEN 1 ELSE 0 END) AS recent_verified,
        AVG(salary_max) AS avg_salary_max,
        MAX(verify_status) AS best_status
      FROM jobs
      WHERE is_online = 1 AND is_deleted = 0
      GROUP BY title
      ORDER BY
        recent_verified DESC,
        job_count DESC,
        avg_salary_max DESC
      LIMIT 30
    `);

    // 算热度分 (recent_verified × 100 + job_count × 10 + (avg_salary_max / 100))
    const result = rows.map((r) => ({
      industry: r.industry,
      job_count: Number(r.job_count) || 0,
      recent_verified: Number(r.recent_verified) || 0,
      avg_salary_max: Math.round(Number(r.avg_salary_max) || 0),
      best_status: r.best_status,
      hot_score: (Number(r.recent_verified) || 0) * 100
                 + (Number(r.job_count) || 0) * 10
                 + Math.round((Number(r.avg_salary_max) || 0) / 100),
    }));

    res.json({
      code: 0,
      data: {
        industries: result,
        total: result.length,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;