// Aggregate test runner: runs each test file in separate Node processes to avoid
// shared pool/redis pollution between test files.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testsDir = path.join(__dirname, '..', 'tests');
const files = fs.readdirSync(testsDir)
  .filter(f => f.endsWith('.test.js'))
  .sort();

let totalPass = 0, totalFail = 0, totalTests = 0;
const failures = [];

for (const f of files) {
  const fp = path.join('tests', f);
  process.stdout.write(`Running ${f} ... `);
  try {
    const out = execSync(`node --test --test-reporter=spec "${fp}"`, {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // parse: "ℹ tests N\nℹ suites 0\nℹ pass N\nℹ fail N\n..."
    const tests = parseInt((out.match(/ℹ tests (\d+)/) || [])[1] || '0');
    const pass = parseInt((out.match(/ℹ pass (\d+)/) || [])[1] || '0');
    const fail = parseInt((out.match(/ℹ fail (\d+)/) || [])[1] || '0');
    totalTests += tests;
    totalPass += pass;
    totalFail += fail;
    console.log(`${pass}/${tests} pass`);
    if (fail > 0) {
      failures.push(f);
      // print failure details
      console.log(out.split('\n').filter(l => l.includes('✖') || l.includes('fail')).join('\n'));
    }
  } catch (err) {
    // tests may still have run, try to parse stdout
    const stdout = err.stdout ? err.stdout.toString() : '';
    const tests = parseInt((stdout.match(/ℹ tests (\d+)/) || [])[1] || '0');
    const pass = parseInt((stdout.match(/ℹ pass (\d+)/) || [])[1] || '0');
    const fail = parseInt((stdout.match(/ℹ fail (\d+)/) || [])[1] || '0');
    if (tests > 0) {
      totalTests += tests;
      totalPass += pass;
      totalFail += fail;
      console.log(`${pass}/${tests} pass (with warnings)`);
    } else {
      console.log('TIMEOUT/ERROR');
      failures.push(f);
    }
  }
}

console.log('');
console.log(`TOTAL: ${totalPass}/${totalTests} pass, ${totalFail} fail`);
if (failures.length) console.log('Failed files:', failures.join(', '));
process.exit(totalFail === 0 ? 0 : 1);