#!/usr/bin/env node
/**
 * 一键初始化数据库：建表 + 灌种子数据
 * 用法：node scripts/db-init.js [--test]
 *
 * R-JobPilot-v2: 加 retry + 详细错误输出 (CI 调试友好)
 *  - 5 次重试 (MySQL 容器可能 TCP socket accept 延迟)
 *  - 详细错误: errno / sqlState / sqlMessage / 失败语句位置
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runOne(conn, sql, label) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await conn.query(sql);
      console.log(`[db-init] ${label} applied (attempt ${attempt})`);
      return;
    } catch (err) {
      const isLast = attempt === MAX_RETRIES;
      console.error(
        `[db-init] ${label} failed (attempt ${attempt}/${MAX_RETRIES}):`
        + `\n  errno: ${err.errno}`
        + `\n  sqlState: ${err.sqlState}`
        + `\n  sqlMessage: ${err.sqlMessage || err.message}`
        + `\n  code: ${err.code}`
      );
      if (isLast) throw err;
      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function run() {
  const schemaPath = path.join(__dirname, '..', 'src', 'db', 'schema.sql');
  const seedPath = path.join(__dirname, '..', 'src', 'db', 'seed.sql');

  const schema = fs.readFileSync(schemaPath, 'utf8');
  const seed = fs.readFileSync(seedPath, 'utf8');

  const conn = await mysql.createConnection({
    host: config.DB.host,
    port: config.DB.port,
    user: config.DB.user,
    password: config.DB.password,
    database: config.DB.database,
    multipleStatements: true,
  });

  try {
    console.log('[db-init] running schema.sql...');
    await runOne(conn, schema, 'schema.sql');

    console.log('[db-init] running seed.sql...');
    await runOne(conn, seed, 'seed.sql');

    console.log('[db-init] done');
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error('[db-init] failed (final):', err.message);
  process.exit(1);
});
