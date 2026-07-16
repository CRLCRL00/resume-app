const express = require('express');
const router = express.Router();
const { userAuth } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const matchService = require('../services/matchService');
const pool = require('../config/db');
const { sanitizeForLlm } = require('../utils/sanitize');
const { idempotency, idempotencyCapture, captureBody } = require('../middleware/idempotency');

async function matchHandler(req, res, next) {
  try {
    const { resume_id } = req.body;
    if (!resume_id) throw new AppError(1000, 'resume_id required', 400);

    // 先查缓存（命中不扣限流）
    const cached = await matchService.checkCache(req.user.userId, resume_id);
    if (cached) return res.json({ code: 0, data: cached });

    // 缓存未命中 → 真实 LLM
    // 在路由边界先把 user-supplied 简历正文 sanitize 一次：
    //  1. 仅在内容里发现可疑 role tag / 控制字符时回写（避免无效 UPDATE 放大）
    //  2. sanitize 后的 content_md 会被下游 service.match → matchPrompt 直接读入喂给 LLM
    const [rows] = await pool.query(
      'SELECT content_md FROM resumes WHERE id = ? AND user_id = ? LIMIT 1',
      [resume_id, req.user.userId]
    );
    if (rows.length) {
      const raw = rows[0].content_md || '';
      const cleaned = sanitizeForLlm(raw);
      if (cleaned !== raw) {
        await pool.query('UPDATE resumes SET content_md = ? WHERE id = ?', [cleaned, resume_id]);
      }
    }

    const result = await matchService.match(req.user.userId, resume_id);
    res.json({ code: 0, data: result });
  } catch (err) { next(err); }
}

router.post('/', userAuth, idempotency({ prefix: 'match' }), captureBody(), matchHandler, idempotencyCapture());

// R73: explain why a specific match got its score.
// Breaks down the score into factor contributions (city/salary/degree/...) so
// the user can see WHY their resume was matched to this job, not just that.
// Falls back to a heuristic breakdown if the match record has no detailed factors.
router.get('/:matchId/explain', userAuth, async (req, res, next) => {
  try {
    const matchId = Number(req.params.matchId);
    if (!Number.isFinite(matchId)) throw new AppError(1000, 'matchId must be numeric', 400);

    const [rows] = await pool.query(
      `SELECT m.id, m.score, m.reason, m.job_id, m.resume_id,
              j.title, j.company, j.city, j.salary_min, j.salary_max, j.degree_required,
              r.source_form
       FROM matches m
       JOIN jobs j ON j.id = m.job_id
       JOIN resumes r ON r.id = m.resume_id
       WHERE m.id = ? AND m.user_id = ?
       LIMIT 1`,
      [matchId, req.user.userId]
    );
    if (!rows.length) throw new AppError(1404, 'match not found', 404);

    const m = rows[0];
    const expectedCity = (() => {
      try { return JSON.parse(m.source_form || '{}')?.expected?.city || null; } catch (_) { return null; }
    })();
    const expectedSalaryMin = (() => {
      try { return JSON.parse(m.source_form || '{}')?.expected?.salary_min || null; } catch (_) { return null; }
    })();
    const userDegree = (() => {
      try { return JSON.parse(m.source_form || '{}')?.education?.degree || null; } catch (_) { return null; }
    })();

    // Heuristic factor scoring (sums to 100): city 25 / salary 25 / degree 20 / reason 30
    const factors = [];

    if (expectedCity && m.city) {
      const hit = expectedCity === m.city;
      factors.push({
        key: 'city',
        label: '城市匹配',
        weight: 25,
        score: hit ? 25 : 0,
        detail: hit ? `${m.city} ✓` : `期望 ${expectedCity}, 实际 ${m.city} ✗`,
      });
    } else {
      factors.push({ key: 'city', label: '城市匹配', weight: 25, score: 12, detail: '未提供期望城市' });
    }

    if (expectedSalaryMin && m.salary_min) {
      const ratio = m.salary_min / Number(expectedSalaryMin);
      let score = 0;
      let detail = '';
      if (ratio >= 1.0) { score = 25; detail = `${m.salary_min} ≥ 期望 ${expectedSalaryMin} ✓`; }
      else if (ratio >= 0.8) { score = 15; detail = `${m.salary_min} 略低于期望 ${expectedSalaryMin} (~${Math.round(ratio * 100)}%)`; }
      else { score = 5; detail = `${m.salary_min} 远低于期望 ${expectedSalaryMin} (~${Math.round(ratio * 100)}%)`; }
      factors.push({ key: 'salary', label: '薪资匹配', weight: 25, score, detail });
    } else {
      factors.push({ key: 'salary', label: '薪资匹配', weight: 25, score: 12, detail: '未提供期望薪资' });
    }

    if (userDegree && m.degree_required) {
      const rank = { '不限': 0, '大专': 1, '本科': 2, '硕士': 3, '博士': 4 };
      const u = rank[userDegree] ?? 1;
      const j = rank[m.degree_required] ?? 1;
      const score = u >= j ? 20 : 0;
      factors.push({
        key: 'degree',
        label: '学历匹配',
        weight: 20,
        score,
        detail: score ? `${userDegree} ≥ ${m.degree_required} ✓` : `${userDegree} < ${m.degree_required} ✗`,
      });
    } else {
      factors.push({ key: 'degree', label: '学历匹配', weight: 20, score: 10, detail: '未匹配 / 学历不限' });
    }

    // reason from LLM (30 weight if non-empty)
    const reasonText = String(m.reason || '').slice(0, 200);
    factors.push({
      key: 'llm_reason',
      label: 'AI 评估',
      weight: 30,
      score: reasonText ? 30 : 0,
      detail: reasonText || 'AI 未给出理由',
    });

    const computed = factors.reduce((sum, f) => sum + f.score, 0);
    res.json({
      code: 0,
      data: {
        match_id: matchId,
        score_recorded: m.score,
        score_computed: computed,
        factors,
        job: { id: m.job_id, title: m.title, company: m.company, city: m.city },
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
