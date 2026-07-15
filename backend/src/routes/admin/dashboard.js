/**
 * R54: Admin business dashboard API
 *
 * 业务数据可视化数据源 — 给 mini-program admin/dashboard 大屏用.
 * 所有路由走 userAuth + adminAuth (经由 admin/index.js 的 router.use(require('./check'))).
 *
 * Endpoints:
 *   GET /api/admin/dashboard/overview    KPI tiles (用户数/简历数/岗位数/匹配数)
 *   GET /api/admin/dashboard/cities      按 city 分组的 jobs + resumes (用户偏好分布)
 *   GET /api/admin/dashboard/salary      按 salary 区间分组的 jobs
 *   GET /api/admin/dashboard/degree      按学位分组的 jobs
 *   GET /api/admin/dashboard/trends      时间序列 (近 14 天每日提交数)
 *
 * Query (optional):
 *   ?days=14  (默认 14, 用于 trends)
 */
const express = require('express');
const router = express.Router();
const { userAuth } = require('../../middleware/auth');
const { adminAuth } = require('../../middleware/adminAuth');
// R55: direct mysql2/promise import — bypass defaultPool wrapping issues
// where db.js's metrics/slow-query wrappers may swap dashPool.query to non-Promise
// (e.g., mysql2 3.22 nested Promise incompatibility). Create our own pool.
const mysql = require('mysql2/promise');
const config = require('../../config');
const dashPool = mysql.createPool({
  host: config.DB.host,
  port: config.DB.port,
  user: config.DB.user,
  password: config.DB.password,
  database: config.DB.database,
  waitForConnections: true,
  connectionLimit: 4,
  charset: 'utf8mb4',
});

// R54: admin/business dashboard API — requires userAuth + adminAuth on every route
router.use(userAuth, adminAuth);

// ---- overview ----
router.get('/overview', async (req, res, next) => {
  try {
    const [[row]] = await dashPool.query(`
      SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM resumes WHERE is_active = 1) AS active_resumes,
        (SELECT COUNT(*) FROM resumes) AS total_resumes,
        (SELECT COUNT(*) FROM jobs WHERE is_online = 1 AND is_deleted = 0) AS online_jobs,
        (SELECT COUNT(*) FROM jobs WHERE is_deleted = 0) AS total_jobs,
        (SELECT COUNT(*) FROM matches) AS total_matches,
        (SELECT COUNT(*) FROM matches WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS matches_7d,
        (SELECT COUNT(*) FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS users_7d,
        (SELECT COUNT(*) FROM resumes WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS resumes_7d
    `);
    res.json({ code: 0, data: row });
  } catch (err) { next(err); }
});

// ---- cities ----
// user 偏好城市 (从 resumes.source_form->'$.expected.city' 提)
// + 岗位城市 (jobs.city)
router.get('/cities', async (req, res, next) => {
  try {
    const [users_city_rows] = await dashPool.query(`
      SELECT
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(source_form, '$.expected.city')), 'unknown') AS city,
        COUNT(*) AS n
      FROM resumes
      WHERE JSON_EXTRACT(source_form, '$.expected.city') IS NOT NULL
        AND is_active = 1
      GROUP BY city
      ORDER BY n DESC
      LIMIT 30
    `);
    const [jobs_city_rows] = await dashPool.query(`
      SELECT
        COALESCE(city, 'unknown') AS city,
        COUNT(*) AS n
      FROM jobs
      WHERE is_deleted = 0 AND is_online = 1
      GROUP BY city
      ORDER BY n DESC
      LIMIT 30
    `);
    res.json({
      code: 0,
      data: {
        users_by_city: users_city_rows,
        jobs_by_city: jobs_city_rows,
      },
    });
  } catch (err) { next(err); }
});

// ---- salary buckets ----
// jobs: 按 salary_min 分桶 (<10, 10-15, 15-20, 20-30, 30+)
router.get('/salary', async (req, res, next) => {
  try {
    const [rows] = await dashPool.query(`
      SELECT
        CASE
          WHEN salary_min < 10000 THEN '<10K'
          WHEN salary_min < 15000 THEN '10-15K'
          WHEN salary_min < 20000 THEN '15-20K'
          WHEN salary_min < 30000 THEN '20-30K'
          WHEN salary_min < 50000 THEN '30-50K'
          ELSE '50K+'
        END AS bucket,
        COUNT(*) AS n,
        ROUND(AVG(salary_min)/1000, 1) AS avg_min_k,
        ROUND(AVG(salary_max)/1000, 1) AS avg_max_k
      FROM jobs
      WHERE is_deleted = 0 AND is_online = 1
      GROUP BY bucket
      ORDER BY FIELD(bucket, '<10K', '10-15K', '15-20K', '20-30K', '30-50K', '50K+')
    `);
    res.json({ code: 0, data: rows });
  } catch (err) { next(err); }
});

// ---- degree ----
router.get('/degree', async (req, res, next) => {
  try {
    const [rows] = await dashPool.query(`
      SELECT COALESCE(degree_required, '不限') AS bucket, COUNT(*) AS n
      FROM jobs
      WHERE is_deleted = 0 AND is_online = 1
      GROUP BY bucket
      ORDER BY n DESC
    `);
    res.json({ code: 0, data: rows });
  } catch (err) { next(err); }
});

// ---- trends ----
// ?days=14 默认. 用 3 个独立子查询简化
router.get('/trends', async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 14));
    const [users_rows] = await dashPool.query(
      `SELECT DATE(created_at) AS date, COUNT(*) AS n
       FROM users
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE(created_at) ORDER BY date`,
      [days]
    );
    const [resume_rows] = await dashPool.query(
      `SELECT DATE(created_at) AS date, COUNT(*) AS n
       FROM resumes
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE(created_at) ORDER BY date`,
      [days]
    );
    const [match_rows] = await dashPool.query(
      `SELECT DATE(created_at) AS date, COUNT(*) AS n
       FROM matches
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE(created_at) ORDER BY date`,
      [days]
    );
    // map date -> { users, resumes, matches }
    const byDate = new Map();
    const setN = (rows, key) => {
      for (const r of rows) {
        const k = r.date.toISOString ? r.date.toISOString().slice(0, 10) : String(r.date);
        const obj = byDate.get(k) || { date: k, users: 0, resumes: 0, matches: 0 };
        obj[key] = Number(r.n);
        byDate.set(k, obj);
      }
    };
    setN(users_rows, 'users');
    setN(resume_rows, 'resumes');
    setN(match_rows, 'matches');
    res.json({ code: 0, data: Array.from(byDate.values()) });
  } catch (err) { next(err); }
});

module.exports = router;
