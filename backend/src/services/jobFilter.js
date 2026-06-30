/**
 * Compute user's total experience years from experiences[] (rough estimate).
 * Returns 0 if no experiences or unparseable dates.
 */
function userYears(form) {
  const exps = form.experiences || [];
  if (!exps.length) return 0;
  let minStart = null, maxEnd = null;
  for (const e of exps) {
    const s = e.start && e.start !== '至今' ? e.start : null;
    const en = e.end && e.end !== '至今' ? e.end : new Date().toISOString().slice(0, 7);
    if (!s && !en) continue;
    if (s && (minStart === null || s < minStart)) minStart = s;
    if (en && (maxEnd === null || en > maxEnd)) maxEnd = en;
  }
  if (!minStart || !maxEnd) return 0;
  const sYear = parseInt(minStart.slice(0, 4), 10);
  const sMonth = parseInt(minStart.slice(5, 7), 10) || 1;
  const eYear = parseInt(maxEnd.slice(0, 4), 10);
  const eMonth = parseInt(maxEnd.slice(5, 7), 10) || 1;
  const years = (eYear - sYear) + (eMonth - sMonth) / 12;
  return Math.max(0, Math.round(years * 10) / 10);
}

/**
 * Parse a job's experience_required string.
 * Returns null if '不限' / '经验不限' / empty / unparseable (no filter).
 * Returns { min, max } for ranges like '1-3年', '3-5年', '5年以上' (max=Infinity).
 */
function parseExpReq(s) {
  if (!s || s === '不限' || s === '经验不限') return null;
  const t = String(s).trim();
  const range = t.match(/^(\d+)\s*[-–~]\s*(\d+)\s*年?$/);
  if (range) return { min: parseInt(range[1], 10), max: parseInt(range[2], 10) };
  const atLeast = t.match(/^(\d+)\s*年以上$/);
  if (atLeast) return { min: parseInt(atLeast[1], 10), max: Infinity };
  const lessThan = t.match(/^(\d+)\s*年以下$/);
  if (lessThan) return { min: 0, max: parseInt(lessThan[1], 10) - 1 };
  return null;
}

function coarseFilter(jobs, userForm, limit) {
  const userCity = userForm.expected?.city || '';
  const uMin = userForm.expected?.salary_min || 0;
  const uMax = userForm.expected?.salary_max || 0;
  const uYears = userYears(userForm);

  const filtered = jobs.filter(j => {
    if (userCity && j.city !== userCity) return false;
    if (uMax > 0 && j.salary_min > uMax * 1.5) return false;
    if (uMin > 0 && j.salary_max < uMin * 0.8) return false;
    // 经验模糊：不限/无要求 → 通过；要求范围且用户在范围外 → 过滤
    const req = parseExpReq(j.experience_required);
    if (req && uYears > req.max) return false;       // 超经验
    if (req && uYears + 1 < req.min) return false;   // 缺经验（容忍 1 年）
    return true;
  });
  return limit ? filtered.slice(0, limit) : filtered;
}

module.exports = { coarseFilter, userYears, parseExpReq };
