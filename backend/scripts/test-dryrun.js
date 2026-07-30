// R63.E: dry-run smoke test (dev only — does not run via CI)
require('dotenv').config();
process.env.MIGRATIONS_DRY_RUN = '1';
const { runMigrations } = require('../src/db/migrate');
runMigrations().then((r) => {
  console.log('DRY-RUN RESULT:', JSON.stringify(r, null, 2));
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });