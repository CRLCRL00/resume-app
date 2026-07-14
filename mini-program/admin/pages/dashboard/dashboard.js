// R54: admin/dashboard - 业务数据可视化大屏
// Pulls from /api/admin/dashboard/{overview,cities,salary,degree,trends}
// Layout: KPI tiles (top) + city distribution (left) + salary buckets (right) + trends (bottom)
const app = getApp();

Page({
  data: {
    overview: null,
    cities_users: [],
    cities_jobs: [],
    salary_buckets: [],
    degree_buckets: [],
    trends: [],
    loading: true,
    error: null,
    barUsers: [],    // [{ label, width, n }] city visualization
    barJobs: [],
    barSalary: [],  // [{ label, width, n }]
  },

  onLoad() {
    this.loadAll();
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh());
  },

  async loadAll() {
    this.setData({ loading: true, error: null });
    try {
      const [overview, cities, salary, degree, trends] = await Promise.all([
        this.fetch('/api/admin/dashboard/overview'),
        this.fetch('/api/admin/dashboard/cities'),
        this.fetch('/api/admin/dashboard/salary'),
        this.fetch('/api/admin/dashboard/degree'),
        this.fetch('/api/admin/dashboard/trends?days=14'),
      ]);
      this.setData({
        loading: false,
        overview: overview.data,
        cities_users: cities.data.users_by_city.slice(0, 10),
        cities_jobs: cities.data.jobs_by_city.slice(0, 10),
        salary_buckets: salary.data,
        degree_buckets: degree.data,
        trends: trends.data,
        // pre-compute bar widths for CSS rendering
        barUsers: this.toBar(cities.data.users_by_city),
        barJobs: this.toBar(cities.data.jobs_by_city),
        barSalary: this.toBar(salary.data, 'bucket'),
      });
    } catch (e) {
      this.setData({ loading: false, error: (e && e.errMsg) || '加载失败' });
    }
  },

  async fetch(path) {
    const { request } = require('../../../utils/request');
    return request({
      url: path,
      silent: true,
      retry: 1,
    });
  },

  toBar(rows, labelKey = 'city') {
    if (!rows || !rows.length) return [];
    const max = Math.max(...rows.map((r) => Number(r.n) || 0), 1);
    return rows.map((r) => ({
      label: r[labelKey] || r.bucket || r.city || '—',
      n: r.n,
      width: Math.max(8, Math.round((Number(r.n) / max) * 100)),
    }));
  },

  // jump to KPI detail page (future)
  goJobs() { wx.navigateTo({ url: '/admin/pages/jobs/list' }); },
});
