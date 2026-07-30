/**
 * R59: openapi server list should reflect current serveo tunnel HN at request time.
 *
 * infra/sync-tunnel-hn.sh (cron every 5 min) writes the current HN to
 * /var/lib/resume-app/serveo.hostname. openapi.js reads this file (cached by
 * mtime) and overrides servers[0].url so Swagger UI shows the live tunnel URL.
 *
 * Tests verify:
 *   1. Default (no state file) → placeholder URL
 *   2. Valid HN in state file → live URL with HN
 *   3. Invalid HN in state file → falls back to placeholder
 *   4. mtime cache works (changing file content without touching mtime → still cached)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SERVEEO_HN_FILE = process.env.SERVEE0_HN_FILE || '/var/lib/resume-app/serveo.hostname';

// We use a tmp file in test to avoid polluting the real production path.
// Note: withTempHnFile is async so we can await run() before cleanup.
// (sync version would delete tmp dir before async test resolves)
async function withTempHnFile(run) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serveo-hn-'));
  const tmpFile = path.join(tmpDir, 'serveo.hostname');
  process.env.SERVEO_HN_FILE = tmpFile;
  // Force fresh module load per env change
  delete require.cache[require.resolve('../src/routes/openapi.js')];
  try {
    return await run(tmpFile);
  } finally {
    delete process.env.SERVEO_HN_FILE;
    delete require.cache[require.resolve('../src/routes/openapi.js')];
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

async function getSpec() {
  const { openapiRouter } = require('../src/routes/openapi.js');
  const app = require('express')();
  app.use('/api/docs', openapiRouter);
  const r = await request(app).get('/api/docs/openapi.json');
  assert.equal(r.status, 200);
  return r.body;
}

test('openapi servers[0]: placeholder when state file missing', async () => {
  await withTempHnFile(async () => {
    // tmp file does not exist
    const spec = await getSpec();
    assert.equal(spec.servers[0].url, 'https://<tunnel-host>.serveousercontent.com');
    assert.match(spec.servers[0].description, /placeholder|replace/i);
  });
});

test('openapi servers[0]: live HN URL when state file has valid HN', async () => {
  await withTempHnFile(async (tmpFile) => {
    fs.writeFileSync(tmpFile, '23a18edcbfa51a5e-43-139-176-199\n');
    const spec = await getSpec();
    assert.equal(spec.servers[0].url, 'https://23a18edcbfa51a5e-43-139-176-199.serveousercontent.com');
    assert.match(spec.servers[0].description, /current/);
  });
});

test('openapi servers[0]: placeholder when state file has malformed HN', async () => {
  await withTempHnFile(async (tmpFile) => {
    fs.writeFileSync(tmpFile, 'not-a-real-hostname\n');
    const spec = await getSpec();
    assert.equal(spec.servers[0].url, 'https://<tunnel-host>.serveousercontent.com');
  });
});

test('openapi servers: keeps IP and dev servers unchanged', async () => {
  await withTempHnFile(async (tmpFile) => {
    fs.writeFileSync(tmpFile, 'aabbccdd00112233-43-139-176-199\n');
    const spec = await getSpec();
    assert.equal(spec.servers.length, 3);
    assert.equal(spec.servers[1].url, 'https://43.139.176.199');
    assert.equal(spec.servers[2].url, 'http://127.0.0.1:3003');
  });
});

test('openapi servers: mtime cache picks up new HN on file change', async () => {
  await withTempHnFile(async (tmpFile) => {
    fs.writeFileSync(tmpFile, 'aabbccdd00112233-43-139-176-199\n');
    const spec1 = await getSpec();
    assert.equal(spec1.servers[0].url, 'https://aabbccdd00112233-43-139-176-199.serveousercontent.com');
    // mutate file content + bump mtime explicitly so cache invalidates
    fs.writeFileSync(tmpFile, 'eeffaabb00112233-43-139-176-199\n');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(tmpFile, future, future);
    const spec2 = await getSpec();
    assert.equal(spec2.servers[0].url, 'https://eeffaabb00112233-43-139-176-199.serveousercontent.com');
  });
});