function buildPaginationParams(page, pageSize) {
  return `?page=${page || 1}&pageSize=${pageSize || 20}`;
}

function formatJobRow(job) {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    city: job.city,
    salary: `${job.salary_min}-${job.salary_max}K`,
    status: job.is_deleted ? 'deleted' : (job.is_online ? 'online' : 'offline'),
  };
}

function formatLogRow(log) {
  return {
    ...log,
    detail: typeof log.detail === 'string' ? JSON.parse(log.detail) : log.detail,
  };
}

function mapActionLabel(action) {
  const map = {
    'job.create': '创建岗位',
    'job.update': '编辑岗位',
    'job.delete': '删除岗位',
    'job.restore': '恢复岗位',
    'job.toggle_online': '切换上下架',
    'prompt.update': '更新 Prompt',
  };
  return map[action] || action;
}

module.exports = { buildPaginationParams, formatJobRow, formatLogRow, mapActionLabel };