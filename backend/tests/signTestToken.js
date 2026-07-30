// One-off: read server JWT_SECRET, sign a token for user id=2, curl /admin/check
const path = require('path');
process.chdir('/opt/resume-app/backend');
const dotenv = require('dotenv');
const fs = require('fs');
const ENV = '/opt/resume-app/backend/.env';
const env = dotenv.parse(fs.readFileSync(ENV));
for (const [k, v] of Object.entries(env)) {
  if (process.env[k] === undefined) process.env[k] = v;
}
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET;
if (!SECRET) { console.error('NO JWT_SECRET'); process.exit(1); }
console.log('JWT_SECRET length:', SECRET.length);

const payload = {
  userId: 2,
  openid: 'oemfzxT1ND_EukOcGdzN3rOWGBaY',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
  jti: 'test-' + Date.now(),
};
const token = jwt.sign(payload, SECRET, { algorithm: 'HS256' });
// Output the token once to a tmp file (operator-paste), no stdout
fs.writeFileSync('/tmp/R93_NEW_TOKEN.txt', token, { mode: 0o600 });
console.log('token written to /tmp/R93_NEW_TOKEN.txt (length:', token.length + ')');

// curl /admin/check
const http = require('http');
const req = http.request({
  host: '127.0.0.1',
  port: 3003,
  path: '/api/admin/check',
  method: 'GET',
  headers: {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json',
  },
}, (res) => {
  let body = '';
  res.on('data', (c) => body += c);
  res.on('end', () => {
    console.log('STATUS:', res.statusCode);
    console.log('BODY:', body);
  });
});
req.on('error', (e) => console.error('REQ ERR:', e.message));
req.end();