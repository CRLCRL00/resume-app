const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');

const PRIVACY = fs.readFileSync(path.join(ROOT, 'docs', 'legal', 'privacy.md'), 'utf8');
const TERMS = fs.readFileSync(path.join(ROOT, 'docs', 'legal', 'terms.md'), 'utf8');

const UPDATED_AT = '2026-06-29';

function getPrivacy() {
  return { title: '隐私协议', content: PRIVACY, updated_at: UPDATED_AT };
}

function getTerms() {
  return { title: '服务条款', content: TERMS, updated_at: UPDATED_AT };
}

module.exports = { getPrivacy, getTerms };
