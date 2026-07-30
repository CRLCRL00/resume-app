/**
 * R70: dashboard weekly report job
 *
 * Generates 5 CSV files (overview/cities/salary/degree/trends) into
 * /var/lib/resume-app/reports/weekly-YYYY-MM-DD/ for the admin to download.
 *
 * Pattern matches R40 adminLogsCleanup job — idempotent, parameterized,
 * defensive logging.
 *
 * Why files (not SMTP):
 *   - No new external dependency (SMTP creds)
 *   - Admin can scp / inspect later
 *   - R68 export endpoint already returns CSV, so we can curl + write
 *   - Future: SMTP if DASHBOARD_REPORT_EMAIL env set
 *
 * Usage:
 *   const { runDashboardWeeklyReport } = require('./jobs/dashboardWeeklyReport');
 *   await runDashboardWeeklyReport({ baseUrl: 'http://127.0.0.1:3003', token: '...' });
 */
'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const defaultLogger = require('../utils/logger');

const REPORT_BASE_DIR = process.env.DASHBOARD_REPORT_DIR || '/var/lib/resume-app/reports';

const SECTIONS = [
  { type: 'overview', label: 'KPI 总览' },
  { type: 'cities', label: '城市分布' },
  { type: 'salary', label: '薪资区间' },
  { type: 'degree', label: '学历要求' },
  { type: 'trends', label: '14 天趋势' },
];

/**
 * Run weekly report.
 * @param {Object} [opts]
 * @param {string} [opts.baseUrl] - server base URL (default: env or 127.0.0.1:3003)
 * @param {string} [opts.token] - admin Bearer token (or cookie)
 * @param {string} [opts.outputDir] - override REPORT_BASE_DIR
 * @param {Object} [opts.logger] - override logger
 */
async function runDashboardWeeklyReport(opts = {}) {
  const logger = opts.logger || defaultLogger;
  const baseUrl = opts.baseUrl || process.env.BACKEND_BASE_URL || 'http://127.0.0.1:3003';
  const token = opts.token || process.env.DASHBOARD_REPORT_TOKEN || '';
  const outputDir = opts.outputDir || REPORT_BASE_DIR;

  const today = new Date().toISOString().slice(0, 10);
  const dir = path.join(outputDir, `weekly-${today}`);

  const t0 = Date.now();
  const result = { dir, sections: [], durationMs: 0, errors: [] };

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    result.errors.push({ step: 'mkdir', err: e.message });
    logger.error({ dir, err: e.message }, 'dashboard weekly report: mkdir failed');
    return result;
  }

  for (const section of SECTIONS) {
    const file = path.join(dir, `${section.type}.csv`);
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const resp = await axios.get(`${baseUrl}/api/admin/dashboard/export`, {
        params: { type: section.type, days: 14 },
        headers,
        responseType: 'text',
        timeout: 15000,
        // Don't throw on 401/403 — admin auth may not be available in cron context
        validateStatus: (s) => s >= 200 && s < 500,
      });
      if (resp.status !== 200) {
        result.errors.push({ section: section.type, status: resp.status, body: String(resp.data).slice(0, 200) });
        logger.warn({ section: section.type, status: resp.status }, 'dashboard weekly report: non-200');
        continue;
      }
      fs.writeFileSync(file, resp.data);
      const size = fs.statSync(file).size;
      result.sections.push({ type: section.type, file, bytes: size });
      logger.info({ section: section.type, bytes: size }, 'dashboard weekly report: section done');
    } catch (e) {
      result.errors.push({ section: section.type, err: e.message });
      logger.error({ section: section.type, err: e.message }, 'dashboard weekly report: section failed');
    }
  }

  result.durationMs = Date.now() - t0;
  logger.info(
    {
      dir,
      sections: result.sections.length,
      errors: result.errors.length,
      durationMs: result.durationMs,
    },
    'dashboard weekly report: complete'
  );
  return result;
}

module.exports = { runDashboardWeeklyReport, SECTIONS, REPORT_BASE_DIR };