const mysql = require('mysql2/promise');
const config = require('./index');

function createPool() {
  return mysql.createPool({
    host: config.DB.host,
    port: config.DB.port,
    user: config.DB.user,
    password: config.DB.password,
    database: config.DB.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    dateStrings: false,
  });
}

const defaultPool = createPool();

module.exports = defaultPool;
module.exports.createPool = createPool;
