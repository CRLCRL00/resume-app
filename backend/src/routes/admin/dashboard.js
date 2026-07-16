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

// ---- user segments (R74) ----
// 按 last_login_at 划分:
//   active    : 7 天内活跃
//   recent    : 8-30 天
//   dormant   : 31-90 天
//   inactive  : 90+ 天 OR 从未登录
//   new       : 注册 ≤ 7 天 (不论活跃度)
router.get('/user-segments', async (req, res, next) => {
  try {
    const [rows] = await dashPool.query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN last_login_at IS NULL THEN 1 ELSE 0 END) AS never_logged_in,
        SUM(CASE WHEN last_login_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS active_7d,
        SUM(CASE WHEN last_login_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                  AND last_login_at < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS recent_8_30d,
        SUM(CASE WHEN last_login_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
                  AND last_login_at < DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS dormant_31_90d,
        SUM(CASE WHEN last_login_at < DATE_SUB(NOW(), INTERVAL 90 DAY) THEN 1 ELSE 0 END) AS inactive_90d_plus,
        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS new_7d
      FROM users
    `);
    const r = rows[0] || {};
    const segments = [
      { key: 'active', label: '活跃 (≤7d)', count: Number(r.active_7d || 0), color: '#4ade80' },
      { key: 'recent', label: '近期 (8-30d)', count: Number(r.recent_8_30d || 0), color: '#5cb6ff' },
      { key: 'dormant', label: '沉睡 (31-90d)', count: Number(r.dormant_31_90d || 0), color: '#fbbf24' },
      { key: 'inactive', label: '流失 (90d+)', count: Number(r.inactive_90d_plus || 0), color: '#f87171' },
      { key: 'never', label: '从未登录', count: Number(r.never_logged_in || 0), color: '#6c7b95' },
      { key: 'new', label: '新注册 (≤7d)', count: Number(r.new_7d || 0), color: '#a78bfa' },
    ];
    res.json({
      code: 0,
      data: {
        total: Number(r.total || 0),
        new_7d: Number(r.new_7d || 0),
        segments,
      },
    });
  } catch (err) { next(err); }
});

// ---- export (CSV) ----
// R68: dashboard data export — admin only, query `type=` and optional `days=`
// Returns text/csv with attachment Content-Disposition so WeChat mp / browser
// downloads the file. utf-8 BOM prepended so Excel opens Chinese characters
// correctly.
router.get('/export', async (req, res, next) => {
  const type = String(req.query.type || 'overview');
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 14));
  try {
    let csv = '﻿'; // utf-8 BOM
    let filename = `dashboard-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
    if (type === 'overview') {
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
      csv += 'metric,value\n';
      for (const k of Object.keys(row)) {
        csv += `${k},${row[k] ?? 0}\n`;
      }
    } else if (type === 'cities') {
      const [users_city_rows] = await dashPool.query(`
        SELECT
          COALESCE(JSON_UNQUOTE(JSON_EXTRACT(source_form, '$.expected.city')), 'unknown') AS city,
          COUNT(*) AS n
        FROM resumes
        WHERE JSON_EXTRACT(source_form, '$.expected.city') IS NOT NULL
          AND is_active = 1
        GROUP BY city ORDER BY n DESC LIMIT 100
      `);
      const [jobs_city_rows] = await dashPool.query(`
        SELECT COALESCE(city, 'unknown') AS city, COUNT(*) AS n
        FROM jobs WHERE is_deleted = 0 AND is_online = 1
        GROUP BY city ORDER BY n DESC LIMIT 100
      `);
      csv += '--- users_by_city ---\n';
      csv += 'city,n\n';
      for (const r of users_city_rows) csv += `${csvEscape(r.city)},${r.n}\n`;
      csv += '--- jobs_by_city ---\n';
      csv += 'city,n\n';
      for (const r of jobs_city_rows) csv += `${csvEscape(r.city)},${r.n}\n`;
    } else if (type === 'salary') {
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
      csv += 'bucket,n,avg_min_k,avg_max_k\n';
      for (const r of rows) csv += `${r.bucket},${r.n},${r.avg_min_k ?? ''},${r.avg_max_k ?? ''}\n`;
    } else if (type === 'degree') {
      const [rows] = await dashPool.query(`
        SELECT COALESCE(degree_required, '不限') AS bucket, COUNT(*) AS n
        FROM jobs WHERE is_deleted = 0 AND is_online = 1
        GROUP BY bucket ORDER BY n DESC
      `);
      csv += 'degree,n\n';
      for (const r of rows) csv += `${csvEscape(r.bucket)},${r.n}\n`;
    } else if (type === 'trends') {
      const [users_rows] = await dashPool.query(
        `SELECT DATE(created_at) AS date, COUNT(*) AS n
         FROM users WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         GROUP BY DATE(created_at) ORDER BY date`,
        [days]
      );
      const [resume_rows] = await dashPool.query(
        `SELECT DATE(created_at) AS date, COUNT(*) AS n
         FROM resumes WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         GROUP BY DATE(created_at) ORDER BY date`,
        [days]
      );
      const [match_rows] = await dashPool.query(
        `SELECT DATE(created_at) AS date, COUNT(*) AS n
         FROM matches WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         GROUP BY DATE(created_at) ORDER BY date`,
        [days]
      );
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
      csv += `date,users,resumes,matches\n`;
      for (const r of byDate.values()) {
        csv += `${r.date},${r.users},${r.resumes},${r.matches}\n`;
      }
    } else {
      return res.status(400).json({ code: 1400, message: `unknown type: ${type}` });
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) { next(err); }
});

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

module.exports = router;
