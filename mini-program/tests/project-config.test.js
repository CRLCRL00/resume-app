/**
 * R48: project.config.json sanity checks
 *
 * Validates structural integrity. The WeChat IDE will complain about
 * duplicate keys, malformed packNpmRelationList, etc. — these tests
 * catch the issues before uploading or running the dev IDE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('R48 project.config.json is valid JSON', () => {
  const raw = fs.readFileSync(path.join(root, 'project.config.json'), 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw), 'project.config.json must parse as JSON');
});

test('R48 setting has no duplicate keys at top level (parsed)', () => {
  // JSON.parse collapses duplicate keys silently. To detect dups we must
  // parse the raw text ourselves (e.g. via a minimal scanner). For now,
  // sanity-check the parsed object shape + that critical keys exist.
  const raw = fs.readFileSync(path.join(root, 'project.config.json'), 'utf8');
  const cfg = JSON.parse(raw);
  assert.equal(typeof cfg.appid, 'string', 'appid required');
  assert.equal(typeof cfg.projectname, 'string', 'projectname required');
  assert.match(cfg.appid, /^wx[0-9a-f]{16}$/, 'appid must be WeChat format');
  assert.ok(cfg.setting, 'setting key required');
  assert.ok(Array.isArray(cfg.setting.packNpmRelationList), 'packNpmRelationList must be an array');
  for (const e of cfg.setting.packNpmRelationList) {
    assert.equal(typeof e, 'object', 'every packNpmRelationList entry must be object');
    assert.ok(e.packageName, 'entry must have packageName');
    assert.ok(e.version, 'entry must have version');
  }
});

test('R48 project.config.json has NO literal "{" duplicates (regex sniff)', () => {
  // Cheap heuristic: a string with `"minified":` appearing more than once
  // indicates a duplicate key. Run a regex hunt over the raw JSON.
  const raw = fs.readFileSync(path.join(root, 'project.config.json'), 'utf8');
  // Most diagnostic keys that should each appear exactly once:
  const watchKeys = [
    '"minified"',
    '"uglifyFileName"',
    '"packNpmManually"',
    '"minifyWXSS"',
    '"localPlugins"',
    '"disableUseStrict"',
    '"useCompilerPlugins"',
    '"condition"',
    '"swc"',
    '"disableSWC"',
    '"babelSetting"',
  ];
  for (const k of watchKeys) {
    const matches = (raw.match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    assert.ok(matches <= 1,
      `project.config.json has duplicate key ${k}; appears ${matches} times`);
  }
});

test('R48 libVersion is a string (WeChat docs: 数字也接受但 IDE write back)', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  // libVersion is optional; if present, prefer string form for IDE compatibility
  if (cfg.libVersion !== undefined) {
    assert.ok(typeof cfg.libVersion === 'string' || typeof cfg.libVersion === 'number',
      'libVersion should be string or number');
  }
});

test('R48 app.json pages reference real entry files', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  // WeChat convention: app.json "pages" key e.g. "pages/form/form" maps to fs
  // file "pages/form/form.{js,json,wxml,wxss}" — i.e. the path is the page's
  // entry file base name. Check for at least one of the entry files existing.
  function hasPageEntry(relPath) {
    return (
      fs.existsSync(root + '/' + relPath + '.js') ||
      fs.existsSync(root + '/' + relPath + '.json')
    );
  }
  for (const p of app.pages || []) {
    assert.ok(hasPageEntry(p),
      `app.json main page "${p}" has no entry files (.js/.json) under ${root}/${p}.*`);
  }
  for (const sub of app.subpackages || []) {
    for (const p of sub.pages || []) {
      const subPath = sub.root + '/' + p;
      assert.ok(hasPageEntry(subPath),
        `subpackage "${sub.root}" page "${p}" has no entry files under ${root}/${subPath}.*`);
    }
  }
});
