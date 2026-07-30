#!/usr/bin/env node
/**
 * 一键初始化数据库：建表 + 灌种子数据
 * 用法：node scripts/db-init.js
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

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
    await conn.query(schema);
    console.log('[db-init] schema applied');

    console.log('[db-init] running seed.sql...');
    await conn.query(seed);
    console.log('[db-init] seed applied');

    console.log('[db-init] done');
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error('[db-init] failed:', err.message);
  process.exit(1);
});
