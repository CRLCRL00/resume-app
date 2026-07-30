#!/usr/bin/env node
/* eslint-disable no-console */
// 启动前 fail-fast 检查：必填变量 + 长度 + 格式
const REQUIRED = [
  { name: 'NODE_ENV', pattern: /^(development|production|test|staging)$/ },
  { name: 'PORT', pattern: /^\d{2,5}$/ },
  { name: 'WX_APPID', minLen: 8 },
  { name: 'WX_SECRET', minLen: 16 },
  { name: 'JWT_SECRET', minLen: 32 },
  { name: 'JWT_EXPIRES_IN', pattern: /^\d+[smhd]$/ },
  { name: 'DB_HOST', minLen: 1 },
  { name: 'DB_USER', minLen: 1 },
  { name: 'DB_PASSWORD', minLen: 1 },
  { name: 'DB_NAME', minLen: 1 },
  { name: 'REDIS_HOST', minLen: 1 },
  { name: 'REDIS_PORT', pattern: /^\d{2,5}$/ },
];

let missing = 0;
for (const rule of REQUIRED) {
  const val = process.env[rule.name];
  if (!val || val === '' || val.startsWith('your_') || val.startsWith('change_me') || val.startsWith('PLACEHOLDER')) {
    console.error(`[env] missing or placeholder: ${rule.name}`);
    missing++;
    continue;
  }
  if (rule.minLen && val.length < rule.minLen) {
    console.error(`[env] ${rule.name} too short (min ${rule.minLen})`);
    missing++;
    continue;
  }
  if (rule.pattern && !rule.pattern.test(val)) {
    console.error(`[env] ${rule.name} bad format: ${val}`);
    missing++;
  }
}

if (missing > 0) {
  console.error(`[env] ${missing} required vars invalid.`);
  process.exit(1);
}
console.log('[env] all required vars OK');
