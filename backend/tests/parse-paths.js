// one-off: parse pm2 log file and dump unique request paths (no auth/token data)
const fs = require('fs');
const path = '/home/ubuntu/.pm2/logs/resume-app-backend-out.log';
try {
  const log = fs.readFileSync(path, 'utf8');
  const re = /"url":"([^"]+)"/g;
  const m = {};
  let r;
  while ((r = re.exec(log)) !== null) {
    m[r[1]] = (m[r[1]] || 0) + 1;
  }
  const sorted = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log(JSON.stringify(sorted, null, 2));
} catch (e) {
  console.error('ERR', e.message);
}