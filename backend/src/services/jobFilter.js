function coarseFilter(jobs, userForm, limit) {
  const userCity = userForm.expected?.city || '';
  const uMin = userForm.expected?.salary_min || 0;
  const uMax = userForm.expected?.salary_max || 0;

  const filtered = jobs.filter(j => {
    if (userCity && j.city !== userCity) return false;
    if (uMax > 0 && j.salary_min > uMax * 1.5) return false;
    if (uMin > 0 && j.salary_max < uMin * 0.8) return false;
    return true;
  });
  return limit ? filtered.slice(0, limit) : filtered;
}

module.exports = { coarseFilter };
