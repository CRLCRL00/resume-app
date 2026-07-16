// R54: admin/dashboard - 业务数据可视化大屏
// R58: + 全屏 1920×1080 大屏模式 (auto-detect on wide screens, manual toggle,
//      live clock, 30s auto-refresh, lock landscape)
const app = getApp();

const FULLSCREEN_REFRESH_MS = 30000;
const FULLSCREEN_MIN_WIDTH = 1024;   // tablet landscape / PC WeChat / wall display

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
    barUsers: [],   // [{ label, width, n }]
    barJobs: [],
    barSalary: [],  // [{ label, width, n }]
    // ---- R58 ----
    mode: 'compact',            // 'compact' | 'fullscreen'
    fullscreenAvailable: false, // device wide enough to support fullscreen
    currentTime: '',            // HH:MM:SS for fs header
    showFullscreenHint: true,   // small toggle btn in compact mode
  },

  _refreshTimer: null,
  _clockTimer: null,

  onLoad() {
    const sys = wx.getSystemInfoSync();
    // 全屏判定: 屏幕宽 ≥ 1024 = 横屏平板/PC/电视墙
    const wide = (sys.windowWidth || sys.screenWidth || 0) >= FULLSCREEN_MIN_WIDTH;
    this.setData({ fullscreenAvailable: wide });
    if (wide) {
      this.enterFullscreen();
    } else {
      this.loadAll();
    }
    // R67: re-evaluate mode when user rotates device or resizes window
    // (tablet/PC users especially flip landscape ↔ portrait)
    try {
      wx.onWindowResize((res) => {
        const w = (res && res.windowWidth) || sys.windowWidth || 0;
        const shouldFs = w >= FULLSCREEN_MIN_WIDTH;
        const currentMode = this.data.mode;
        // Only switch on transitions, not every pixel change
        if (shouldFs && currentMode !== 'fullscreen') {
          this.enterFullscreen();
        } else if (!shouldFs && currentMode === 'fullscreen') {
          this.exitFullscreen();
        }
      });
    } catch (e) {
      // onWindowResize may not exist on older mp runtimes — fail silent
    }
  },

  onUnload() {
    try { wx.offWindowResize && wx.offWindowResize(); } catch (e) {}
    this._clearTimers();
  },

  onPullDownRefresh() {
    // 仅 compact 模式可下拉
    if (this.data.mode === 'compact') {
      this.loadAll().then(() => wx.stopPullDownRefresh());
    } else {
      wx.stopPullDownRefresh();
    }
  },

  // ---- R58 mode switching ----

  enterFullscreen() {
    this.setData({ mode: 'fullscreen', loading: true, error: null });
    // 尝试锁横屏 (失败静默: 竖屏手机不支持)
    try {
      wx.setPageOrientation({ orientation: 'landscape' });
    } catch (e) { /* keep current orientation */ }
    this._tickTime();
    this._clockTimer = setInterval(() => this._tickTime(), 1000);
    this.loadAll().then(() => {
      this._startAutoRefresh();
    });
  },

  exitFullscreen() {
    this.setData({ mode: 'compact' });
    this._clearTimers();
    try {
      wx.setPageOrientation({ orientation: 'portrait' });
    } catch (e) { /* keep current orientation */ }
    this.loadAll();
  },

  toggleFullscreen() {
    if (this.data.mode === 'fullscreen') {
      this.exitFullscreen();
    } else {
      this.enterFullscreen();
    }
  },

  _tickTime() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    this.setData({
      currentTime: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    });
  },

  _startAutoRefresh() {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    this._refreshTimer = setInterval(() => {
      // 后台静默刷新，不弹 loading mask
      this._loadAllSilent();
    }, FULLSCREEN_REFRESH_MS);
  },

  _clearTimers() {
    if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
    if (this._clockTimer)   { clearInterval(this._clockTimer);   this._clockTimer = null; }
  },

  // ---- data loading ----

  async loadAll() {
    this.setData({ loading: true, error: null });
    try {
      await this._doLoad();
      this.setData({ loading: false });
    } catch (e) {
      this.setData({ loading: false, error: (e && e.errMsg) || '加载失败' });
    }
  },

  // R58: 全屏模式用的静默刷新 — 不切 loading mask，不清空旧数据
  async _loadAllSilent() {
    try {
      await this._doLoad();
      this.setData({ error: null });
    } catch (e) {
      // 静默: 仅更新 error 文字，不闪烁
      this.setData({ error: (e && e.errMsg) || '刷新失败' });
    }
  },

  async _doLoad() {
    const [overview, cities, salary, degree, trends] = await Promise.all([
      this._fetch('/api/admin/dashboard/overview'),
      this._fetch('/api/admin/dashboard/cities'),
      this._fetch('/api/admin/dashboard/salary'),
      this._fetch('/api/admin/dashboard/degree'),
      this._fetch('/api/admin/dashboard/trends?days=14'),
    ]);
    this.setData({
      overview: overview.data,
      cities_users: cities.data.users_by_city.slice(0, 10),
      cities_jobs: cities.data.jobs_by_city.slice(0, 10),
      salary_buckets: salary.data,
      degree_buckets: degree.data,
      trends: trends.data,
      barUsers: this._toBar(cities.data.users_by_city),
      barJobs: this._toBar(cities.data.jobs_by_city),
      barSalary: this._toBar(salary.data, 'bucket'),
    });
  },

  async _fetch(path) {
    const { request } = require('../../../utils/request');
    return request({
      url: path,
      silent: true,
      retry: 1,
    });
  },

  _toBar(rows, labelKey = 'city') {
    if (!rows || !rows.length) return [];
    const max = Math.max(...rows.map((r) => Number(r.n) || 0), 1);
    return rows.map((r) => ({
      label: r[labelKey] || r.bucket || r.city || '—',
      n: r.n,
      width: Math.max(8, Math.round((Number(r.n) / max) * 100)),
    }));
  },

  goJobs() { wx.navigateTo({ url: '/admin/pages/jobs/list' }); },

  // R68: CSV export — show action sheet to pick section, then call backend,
  // copy temp file URL for user to share / open with Excel.
  onExportTap() {
    wx.showActionSheet({
      itemList: ['总览 (overview)', '城市 (cities)', '薪资 (salary)', '学历 (degree)', '趋势 (trends)'],
      success: (res) => {
        const types = ['overview', 'cities', 'salary', 'degree', 'trends'];
        const type = types[res.tapIndex];
        if (type) this._exportCsv(type);
      },
    });
  },

  async _exportCsv(type) {
    wx.showLoading({ title: '生成中…' });
    try {
      const { request } = require('../../../utils/request');
      // request() expects JSON; for CSV we hit the URL directly via downloadFile.
      const { apiBaseUrl } = require('../../../src/config');
      const token = (function () {
        try { return require('../../../utils/auth').getToken(); } catch (_) { return ''; }
      })();
      const url = `${apiBaseUrl}/api/admin/dashboard/export?type=${type}`;
      // Download via wx.downloadFile (returns temp file path)
      const dl = await new Promise((resolve, reject) => {
        wx.downloadFile({
          url,
          header: token ? { Authorization: `Bearer ${token}` } : {},
          success: resolve,
          fail: reject,
        });
      });
      wx.hideLoading();
      if (dl.statusCode !== 200) {
        wx.showToast({ title: `导出失败 (${dl.statusCode})`, icon: 'none' });
        return;
      }
      wx.showModal({
        title: '已导出',
        content: 'CSV 已下载。可点击"打开"用 Excel 查看。',
        confirmText: '打开',
        cancelText: '复制路径',
        success: (m) => {
          if (m.confirm) {
            wx.openDocument({ filePath: dl.tempFilePath, fileType: 'csv', showMenu: true });
          } else if (m.cancel) {
            wx.setClipboardData({ data: dl.tempFilePath });
          }
        },
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '导出失败: ' + (e.errMsg || e.message || ''), icon: 'none' });
    }
  },
});