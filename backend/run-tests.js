// Cross-platform test runner: set NODE_ENV=test, then run node --test
process.env.NODE_ENV = 'test';
process.env.npm_lifecycle_event = 'test'; // belt-and-suspenders for the isTestEnv check
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const args = [
  '--test',
  '--test-force-exit',
  '--test-concurrency=1',
  ...process.argv.slice(2),
];
if (args.length === 4) {
  // No explicit files: include all
  args.push('tests/*.test.js');
}

const result = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test', npm_lifecycle_event: 'test' },
});
process.exit(result.status || 0);
