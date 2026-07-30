/**
 * R62: migration runner — auto-apply pending SQL migrations at boot.
 *
 * Why: diagnose.js (R40+) only WARNS about missing tables/columns; it never
 * creates them. Previously, every new table required ops to manually
 * `mysql ... < 004-admin-audit.sql` on the server, which is error-prone.
 * R61 audit found that `admin_audit` was missing on prod even though the
 * migration file existed in the repo.
 *
 * How:
 *   - On boot, ensure schema_migrations table exists.
 *   - Read all *.sql files in backend/src/db/migrations/ (alphabetical).
 *   - For each file not already in schema_migrations: apply SQL in a tx,
 *     then insert (name) into schema_migrations.
 *   - Idempotent: re-running boot doesn't re-apply.
 *   - Failed migration aborts (no partial apply): rolls back tx, logs error,
 *     continues boot (server stays up, but migration state is unchanged).
 *
 * Naming convention:
 *   NNN-kebab-name.sql (NNN = numeric order, zero-padded for sort)
 *   Example: 004-admin-audit.sql, 028-client-errors.sql
 *   The filename (without .sql) is the unique name stored in schema_migrations.
 *
 * SQL requirements:
 *   - Idempotent (use CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS)
 *   - One or more ; -terminated statements (split + apply each)
 */
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Lazy load pool so tests can require this module without opening DB connections.
// (require cache is module-level; config/db opens pools on require.)
function getDefaultPool() {
  return require('../config/db');
}

async function ensureMigrationsTable(p) {
  await p.query(`
    CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
      \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`name\` VARCHAR(128) NOT NULL,
      \`applied_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uk_name\` (\`name\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function splitStatements(sql) {
  // Strip line comments (-- ...) and split on ; at end-of-line / end-of-file
  // mysql2 doesn't enable multiStatements by default, so we run each stmt separately.
  const cleaned = sql
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
  return cleaned
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function applyOne(p, name, sql) {
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    const statements = splitStatements(sql);
    for (const stmt of statements) {
      await conn.query(stmt);
    }
    await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Run all pending migrations. Returns:
 *   { applied: string[], skipped: string[], failed: { file, err } | null, dryRun?: boolean }
 *
 * Always returns — never throws. Caller decides whether to fail boot.
 *
 * Env:
 *   MIGRATIONS_DRY_RUN=1  log + return as if applied, but DON'T write to DB
 *                         (useful for prod deploy validation: "what would change?")
 *
 * @param {Object} [opts]
 * @param {Object} [opts.pool] - override pool (for tests). Falls back to config/db.
 * @param {boolean} [opts.dryRun] - override env, force dry-run mode.
 */
async function runMigrations({ pool: customPool, dryRun } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test') {
    return { applied: [], skipped: ['test-env'], failed: null };
  }
  const isDryRun = dryRun === true || process.env.MIGRATIONS_DRY_RUN === '1';
  const p = customPool || getDefaultPool();
  const result = { applied: [], skipped: [], failed: null };
  if (isDryRun) result.dryRun = true;
  try {
    if (!isDryRun) {
      await ensureMigrationsTable(p);
    } else {
      logger.warn('MIGRATIONS_DRY_RUN=1 — will NOT write to DB');
    }

    const [appliedRows] = isDryRun
      ? [[]]  // skip the query — treat as empty (no migrations applied)
      : await p.query('SELECT name FROM schema_migrations');
    const applied = new Set(appliedRows.map((r) => r.name));
    const files = listMigrationFiles();
    for (const file of files) {
      const name = file.replace(/\.sql$/, '');
      if (applied.has(name)) {
        result.skipped.push(name);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      if (isDryRun) {
        const stmtCount = splitStatements(sql).length;
        logger.info({ migration: name, statements: stmtCount }, 'DRY-RUN: would apply');
        result.applied.push(name);
        continue;
      }
      try {
        await applyOne(p, name, sql);
        logger.info({ migration: name }, 'migration applied at boot');
        result.applied.push(name);
      } catch (err) {
        logger.error({ migration: name, err: err.message }, 'migration failed at boot');
        result.failed = { file: name, err: err.message };
        break; // stop on first failure — no partial apply
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, 'migration runner errored');
    result.failed = { file: '<runner>', err: err.message };
  }
  _lastResult = result; // R63.D: cache for /api/health/ready endpoint
  return result;
}

// R63.D: track last runMigrations result so /api/health/ready can show migration state
let _lastResult = null;
function getLastResult() {
  return _lastResult;
}

module.exports = {
  runMigrations,
  splitStatements,
  listMigrationFiles,
  getLastResult,
};