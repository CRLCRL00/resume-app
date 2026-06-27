const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// 强制从 backend 根目录加载 .env（只在第一次加载时填充 process.env，
// 避免测试中"删除后检测缺失"被重新填充覆盖）
const ENV_PATH = path.join(__dirname, '..', '..', '.env');
const LOADED_FLAG = '__RESUME_APP_ENV_LOADED__';

if (!process.env[LOADED_FLAG]) {
  const fileEnv = dotenv.parse(fs.readFileSync(ENV_PATH));
  for (const [k, v] of Object.entries(fileEnv)) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
    }
  }
  process.env[LOADED_FLAG] = '1';
}

const REQUIRED = [
  'PORT', 'WX_APPID', 'WX_SECRET', 'JWT_SECRET',
  'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
  'REDIS_HOST', 'REDIS_PASSWORD',
  'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL',
];

function load() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
  return {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseInt(process.env.PORT, 10),
    WX_APPID: process.env.WX_APPID,
    WX_SECRET: process.env.WX_SECRET,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '30d',
    DB_HOST: process.env.DB_HOST,
    DB_PORT: parseInt(process.env.DB_PORT, 10) || 3306,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
    DB_NAME: process.env.DB_NAME,
    DB: {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    },
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: parseInt(process.env.REDIS_PORT, 10) || 6379,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    REDIS: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT, 10) || 6379,
      password: process.env.REDIS_PASSWORD,
    },
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    DEEPSEEK: {
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL,
      model: process.env.DEEPSEEK_MODEL,
    },
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  };
}

module.exports = load();