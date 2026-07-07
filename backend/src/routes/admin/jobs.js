const express = require('express');
const router = express.Router();
const { userAuth } = require('../../middleware/auth');
const { adminAuth } = require('../../middleware/adminAuth');
const { twoFactorRequired } = require('../../middleware/twoFactorRequired');
const { AppError } = require('../../middleware/errorHandler');
const { jobSchema, validateBody } = require('../../middleware/validate');
const pool = require('../../config/db');
const adminLog = require('../../services/adminLog');

// 通用分页
function parsePage(req) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 20, 100);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

router.get('/jobs', userAuth, adminAuth, async (req, res, next) => {
  try {
    const { page, pageSize, offset } = parsePage(req);
    const [items] = await pool.query(
      'SELECT id, title, company, city, salary_min, salary_max, is_online, is_deleted, created_at FROM jobs ORDER BY id DESC LIMIT ? OFFSET ?',
      [pageSize, offset]
    );
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM jobs');
    res.json({ code: 0, data: { items, total, page, pageSize } });
  } catch (err) { next(err); }
});

router.post('/jobs', userAuth, adminAuth, twoFactorRequired, validateBody(jobSchema, { stripUnknown: false }), async (req, res, next) => {
  try {
    const value = req.body;
    const [r] = await pool.query(
      'INSERT INTO jobs (title, company, city, salary_min, salary_max, degree_required, experience_required, skills_required, description_md) VALUES (?,?,?,?,?,?,?,?,?)',
      [value.title, value.company, value.city, value.salary_min, value.salary_max,
       value.degree_required, value.experience_required,
       JSON.stringify(value.skills_required), value.description_md]
    );
    await adminLog.record(req.user.openid, 'job.create', 'job', r.insertId, value, req.ip);
    res.json({ code: 0, data: { job_id: r.insertId } });
  } catch (err) { next(err); }
});

router.put('/jobs/:id', userAuth, adminAuth, twoFactorRequired, validateBody(jobSchema, { stripUnknown: false }), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) throw new AppError(1000, 'invalid id', 400);
    const value = req.body;
    const [r] = await pool.query(
      'UPDATE jobs SET title=?, company=?, city=?, salary_min=?, salary_max=?, degree_required=?, experience_required=?, skills_required=?, description_md=? WHERE id=?',
      [value.title, value.company, value.city, value.salary_min, value.salary_max,
       value.degree_required, value.experience_required,
       JSON.stringify(value.skills_required), value.description_md, id]
    );
    if (!r.affectedRows) throw new AppError(1004, 'job not found', 404);
    await adminLog.record(req.user.openid, 'job.update', 'job', id, value, req.ip);
    res.json({ code: 0, data: { updated: true } });
  } catch (err) { next(err); }
});

router.patch('/jobs/:id/online', userAuth, adminAuth, twoFactorRequired, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) throw new AppError(1000, 'invalid id', 400);
    const [[job]] = await pool.query('SELECT is_online FROM jobs WHERE id = ?', [id]);
    if (!job) throw new AppError(1004, 'job not found', 404);
    const newVal = job.is_online ? 0 : 1;
    await pool.query('UPDATE jobs SET is_online = ? WHERE id = ?', [newVal, id]);
    await adminLog.record(req.user.openid, 'job.toggle_online', 'job', id, { is_online: newVal }, req.ip);
    res.json({ code: 0, data: { is_online: newVal } });
  } catch (err) { next(err); }
});

router.delete('/jobs/:id', userAuth, adminAuth, twoFactorRequired, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) throw new AppError(1000, 'invalid id', 400);
    const [r] = await pool.query('UPDATE jobs SET is_deleted = 1 WHERE id = ?', [id]);
    if (!r.affectedRows) throw new AppError(1004, 'job not found', 404);
    await adminLog.record(req.user.openid, 'job.delete', 'job', id, null, req.ip);
    res.json({ code: 0, data: { deleted: true } });
  } catch (err) { next(err); }
});

router.patch('/jobs/:id/restore', userAuth, adminAuth, twoFactorRequired, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) throw new AppError(1000, 'invalid id', 400);
    const [r] = await pool.query('UPDATE jobs SET is_deleted = 0 WHERE id = ?', [id]);
    if (!r.affectedRows) throw new AppError(1004, 'job not found', 404);
    await adminLog.record(req.user.openid, 'job.restore', 'job', id, null, req.ip);
    res.json({ code: 0, data: { restored: true } });
  } catch (err) { next(err); }
});

module.exports = router;