/**
 * R62: migration runner tests
 *
 * Uses a mock pool to verify:
 *   - applies pending migrations in order
 *   - skips already-applied migrations
 *   - aborts on first failure (no partial apply)
 *   - splits multi-statement SQL on ;
 *   - strips -- line comments before splitting
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitStatements, listMigrationFiles } = require('../src/db/migrate');

test('splitStatements: simple single CREATE TABLE', () => {
  const sql = 'CREATE TABLE foo (id INT);';
  assert.deepEqual(splitStatements(sql), ['CREATE TABLE foo (id INT)']);
});

test('splitStatements: multi-statement split on ; + newline', () => {
  const sql = `CREATE TABLE a (id INT);
CREATE TABLE b (id INT);
INSERT INTO a VALUES (1);`;
  const out = splitStatements(sql);
  assert.equal(out.length, 3);
  assert.match(out[0], /CREATE TABLE a/);
  assert.match(out[1], /CREATE TABLE b/);
  assert.match(out[2], /INSERT INTO a/);
});

test('splitStatements: strips line comments', () => {
  const sql = `-- this is a comment
CREATE TABLE foo (id INT);
-- another comment
CREATE TABLE bar (id INT);`;
  const out = splitStatements(sql);
  assert.equal(out.length, 2);
  assert.match(out[0], /CREATE TABLE foo/);
  assert.match(out[1], /CREATE TABLE bar/);
  // ensure no comment text leaked in
  assert.ok(!out.some((s) => s.includes('this is a comment')));
  assert.ok(!out.some((s) => s.includes('another comment')));
});

test('splitStatements: trims whitespace', () => {
  const sql = '   CREATE TABLE foo (id INT)  ;  \n\n  ';
  const out = splitStatements(sql);
  assert.deepEqual(out, ['CREATE TABLE foo (id INT)']);
});

test('splitStatements: empty input returns []', () => {
  assert.deepEqual(splitStatements(''), []);
  assert.deepEqual(splitStatements('-- only comments\n'), []);
});

test('listMigrationFiles: returns sorted *.sql', () => {
  // migrations/ dir contains 004-admin-audit.sql and 005-alerts-dead-letter.sql
  const files = listMigrationFiles();
  assert.ok(files.length >= 2, `expected >= 2 files, got ${files.length}`);
  // sorted alphabetically
  for (let i = 1; i < files.length; i++) {
    assert.ok(files[i - 1] < files[i], `not sorted: ${files[i - 1]} >= ${files[i]}`);
  }
  // all end in .sql
  assert.ok(files.every((f) => f.endsWith('.sql')));
});

test('listMigrationFiles: each filename has NNN-name format', () => {
  const files = listMigrationFiles();
  for (const f of files) {
    assert.match(f, /^\d{3}-[a-z0-9-]+\.sql$/, `bad filename: ${f}`);
  }
});

// Mock-based integration test of runMigrations()
// We don't want to hit real MySQL, so we stub the pool.
test('runMigrations: applies pending, skips applied, aborts on failure', async () => {
  // Build a minimal mock pool that records calls
  const calls = [];
  const mockPool = {
    async query(sql, params) {
      calls.push({ sql, params });
      // schema_migrations is queried first to get applied set
      if (/SELECT name FROM schema_migrations/i.test(sql)) {
        return [[{ name: '004-admin-audit' }]]; // already applied
      }
      // Otherwise pretend success
      return [{ affectedRows: 0 }];
    },
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async query(sql, params) {
          calls.push({ sql, params });
          return [{ affectedRows: 0 }];
        },
      };
    },
  };

  const { runMigrations } = require('../src/db/migrate');
  const result = await runMigrations({ pool: mockPool });

  // Should apply migrations NOT in {004-admin-audit}.
  // Files in migrations/: 002-privacy-versions, 004-admin-audit, 005-alerts-dead-letter, 028-client-errors
  // Already-applied: 004. So apply order (alphabetical): 002, 005, 028
  assert.deepEqual(result.applied, ['002-privacy-versions', '005-alerts-dead-letter', '028-client-errors']);
  assert.ok(result.skipped.includes('004-admin-audit'));
  assert.equal(result.failed, null);
});

test('runMigrations: aborts on first migration failure', async () => {
  const calls = [];
  const mockPool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT name FROM schema_migrations/i.test(sql)) {
        return [[]]; // nothing applied yet
      }
      return [{ affectedRows: 0 }];
    },
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async query(sql) {
          calls.push({ sql });
          // Fail on first CREATE TABLE
          if (/CREATE TABLE/i.test(sql)) {
            throw new Error('mock: syntax error');
          }
          return [{ affectedRows: 0 }];
        },
      };
    },
  };

  const { runMigrations } = require('../src/db/migrate');
  // Reset require cache to allow fresh mock injection (but runMigrations checks NODE_ENV)
  process.env.NODE_ENV = 'production';
  delete require.cache[require.resolve('../src/db/migrate')];
  const { runMigrations: freshRun } = require('../src/db/migrate');
  const result = await freshRun({ pool: mockPool });
  process.env.NODE_ENV = 'test';
  delete require.cache[require.resolve('../src/db/migrate')];

  // First migration alphabetically (002-privacy-versions) should fail on its CREATE TABLE
  assert.ok(result.failed, 'expected failed to be populated');
  assert.equal(result.failed.file, '002-privacy-versions');
  assert.match(result.failed.err, /syntax error/);
  // No migrations should have been marked as applied (transaction rolled back)
  assert.equal(result.applied.length, 0);
});

test('runMigrations: dry-run mode logs without writing', async () => {
  // Track all queries to ensure none of them write to DB
  const queries = [];
  const mockPool = {
    async query(sql) {
      queries.push(sql);
      if (/SELECT name FROM schema_migrations/i.test(sql)) {
        return [[]]; // empty applied set
      }
      return [{ affectedRows: 0 }];
    },
    async getConnection() {
      // dry-run should NEVER call getConnection
      throw new Error('dry-run must not open transactions');
    },
  };

  process.env.NODE_ENV = 'production';
  delete require.cache[require.resolve('../src/db/migrate')];
  const { runMigrations: freshRun } = require('../src/db/migrate');
  const result = await freshRun({ pool: mockPool, dryRun: true });
  process.env.NODE_ENV = 'test';
  delete require.cache[require.resolve('../src/db/migrate')];

  assert.equal(result.dryRun, true, 'dryRun flag set');
  // In dry-run with empty applied set: all 4 migrations (002, 004, 005, 028) would apply
  assert.ok(result.applied.length >= 4, `expected all 4 migrations in dry-run applied, got ${result.applied.length}`);
  // No SELECT against schema_migrations (skipped in dry-run)
  assert.ok(
    !queries.some((q) => /SELECT name FROM schema_migrations/i.test(q)),
    'dry-run must not query schema_migrations'
  );
  // No CREATE TABLE queries (no DB writes)
  assert.ok(
    !queries.some((q) => /CREATE TABLE/i.test(q)),
    'dry-run must not execute CREATE TABLE'
  );
});