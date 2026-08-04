/**
 * R130: 行业路由 — 首页推荐用
 * R139: 扩 top_city + common_degree (R139 用来预填 jobpilot Step 0 city + salary 字段)
 * GET /api/industries 返回 [{industry, job_count, recent_verified, avg_salary_max, top_city, common_degree}]
 *
 * 数据源: jobs 表 title DISTINCT + 统计 (verify_status + verified_at + salary_max + city + degree_required)
 *
 * 注: jobs 表没有 industry 字段,用 title 作为类目。
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/db');

router.get('/', async (req, res, next) => {
  try {
    // R139: 主查询 + 子查询并行 (top_city / common_degree)
    // R-JobPilot-v2 W4: 加 j1 别名 + recent_new_jobs 子查询 (近 7 天新增岗位数)
    // 主: 每个 title 统计
    const [rows] = await pool.query(`
      SELECT
        title AS industry,
        COUNT(*) AS job_count,
        SUM(CASE WHEN verify_status = 'verified'
                  AND verified_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                 THEN 1 ELSE 0 END) AS recent_verified,
        AVG(salary_max) AS avg_salary_max,
        MAX(verify_status) AS best_status,
        (SELECT COUNT(*) FROM jobs j2
         WHERE j2.title = j1.title
           AND j2.is_online = 1 AND j2.is_deleted = 0
           AND j2.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS recent_new_jobs
      FROM jobs j1
      WHERE is_online = 1 AND is_deleted = 0
      GROUP BY title
      ORDER BY
        recent_verified DESC,
        job_count DESC,
        avg_salary_max DESC
      LIMIT 30
    `);

    // R139: 对每个行业单独算 top_city (出现最多的城市) 和 common_degree (出现最多的学历)
    // 用 IN (...) 一次性查, 避免 N+1
    const titles = rows.map(r => r.industry);
    let cityMap = new Map();
    let degreeMap = new Map();

    if (titles.length > 0) {
      const placeholders = titles.map(() => '?').join(',');
      const [cityRows] = await pool.query(
        `SELECT title, city, COUNT(*) AS cnt
         FROM jobs
         WHERE is_online = 1 AND is_deleted = 0 AND title IN (${placeholders})
         GROUP BY title, city
         ORDER BY title, cnt DESC`,
        titles
      );
      for (const r of cityRows) {
        // 每个 title 只取 cnt 最大的 city
        if (!cityMap.has(r.title)) cityMap.set(r.title, r.city);
      }

      const [degreeRows] = await pool.query(
        `SELECT title, degree_required, COUNT(*) AS cnt
         FROM jobs
         WHERE is_online = 1 AND is_deleted = 0 AND title IN (${placeholders})
           AND degree_required != '不限'
         GROUP BY title, degree_required
         ORDER BY title, cnt DESC`,
        titles
      );
      for (const r of degreeRows) {
        if (!degreeMap.has(r.title)) degreeMap.set(r.title, r.degree_required);
      }

      // R-JobPilot-v2 W4: common_experience — 同 degree 模式, 取每个 title 出现最多的 experience_required (排除"不限")
      const expMap = new Map();
      const [expRows] = await pool.query(
        `SELECT title, experience_required, COUNT(*) AS cnt
         FROM jobs
         WHERE is_online = 1 AND is_deleted = 0 AND title IN (${placeholders})
           AND experience_required != '不限'
         GROUP BY title, experience_required
         ORDER BY title, cnt DESC`,
        titles
      );
      for (const r of expRows) {
        if (!expMap.has(r.title)) expMap.set(r.title, r.experience_required);
      }
    }

    // 算热度分 (recent_verified × 100 + job_count × 10 + (avg_salary_max / 100))
    const result = rows.map((r) => ({
      industry: r.industry,
      job_count: Number(r.job_count) || 0,
      recent_verified: Number(r.recent_verified) || 0,
      avg_salary_max: Math.round(Number(r.avg_salary_max) || 0),
      best_status: r.best_status,
      // R139: 新加 top_city + common_degree (前端用于预填 jobpilot Step 0)
      top_city: cityMap.get(r.industry) || '',
      common_degree: degreeMap.get(r.industry) || '不限',
      // R-JobPilot-v2 W4: 新加 common_experience + recent_new_jobs (行业卡片信息密度)
      common_experience: expMap.get(r.industry) || '不限',
      recent_new_jobs: Number(r.recent_new_jobs) || 0,
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