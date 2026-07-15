const pool = require('../config/db');
const redis = require('../config/redis');
const logger = require('../utils/logger');
const { checkRedisPersistence } = require('./redisCheck');

// 关键表列表（应用主路径用到的）
// R63: removed phantom `match_results` and `audit_logs` — never implemented,
// only in REQUIRED_TABLES by mistake. Actual code uses `matches` and
// `admin_operation_logs` (legacy) + `admin_audit` (R40+).
const REQUIRED_TABLES = [
  'users', 'resumes', 'jobs', 'matches',
  'admin_audit', 'privacy_versions',
  'admins', 'prompts', 'schema_migrations',
];

// 每张表关键 column（防止 dropped column）
const REQUIRED_COLUMNS = {
  users: ['id', 'openid', 'created_at'],
  resumes: ['id', 'user_id', 'content_md', 'created_at'],
  jobs: ['id', 'title', 'company', 'created_at'],
  matches: ['id', 'user_id', 'created_at'],
  admin_audit: ['id', 'openid', 'action', 'created_at'],
  privacy_versions: ['id', 'doc_type', 'version'],
  admins: ['id', 'openid'],
  prompts: ['id', 'code', 'content'],
  schema_migrations: ['id', 'name'],
};

const isTest = () => process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test';

/**
 * Run all startup checks.
 * Logs warnings on missing tables/columns/seed.
 * Returns { ok: boolean, warnings: string[] }.
 * Never throws — caller can ignore failures.
 */
async function diagnose() {
  if (isTest()) return { ok: true, warnings: [] };

  const warnings = [];

  // 1. Check tables
  try {
    const [rows] = await pool.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?`,
      [process.env.DB_NAME]
    );
    const existing = new Set(rows.map(r => r.TABLE_NAME));
    for (const table of REQUIRED_TABLES) {
      if (!existing.has(table)) {
        warnings.push(`[diagnose] missing table: ${table}`);
      }
    }

    // 2. Check columns
    for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
      if (!existing.has(table)) continue;
      const [colRows] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [process.env.DB_NAME, table]
      );
      const colSet = new Set(colRows.map(r => r.COLUMN_NAME));
      for (const col of cols) {
        if (!colSet.has(col)) {
          warnings.push(`[diagnose] missing column: ${table}.${col}`);
        }
      }
    }

    // 3. Check admin seed (at least one admin openid exists)
    if (existing.has('admins')) {
      const [adminRows] = await pool.query('SELECT COUNT(*) AS c FROM admins');
      if (Number(adminRows[0].c) === 0) {
        warnings.push('[diagnose] no admin seeded in admins table');
      }
    }

    // 4. schema_migrations version
    if (existing.has('schema_migrations')) {
      const [migRows] = await pool.query(
        'SELECT name FROM schema_migrations ORDER BY id'
      );
      const migrations = migRows.map(r => r.name);
      if (migrations.length === 0) {
        warnings.push('[diagnose] schema_migrations is empty');
      }
    }
  } catch (err) {
    warnings.push(`[diagnose] db connect/inspect failed: ${err.message}`);
  }

  // 5. Redis persistence (AOF + RDB) — only outside test env
  if (!isTest()) {
    try {
      const redisResult = await checkRedisPersistence(redis);
      for (const w of redisResult.warnings) warnings.push(w);
    } catch (err) {
      warnings.push(`[diagnose] redis persistence check threw: ${err.message}`);
    }
  }

  for (const w of warnings) {
    logger.warn(w);
  }

  return { ok: warnings.length === 0, warnings };
}

module.exports = { diagnose, REQUIRED_TABLES, checkRedisPersistence };