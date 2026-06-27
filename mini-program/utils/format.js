function parseYearMonth(s) {
  if (s === '至今') return null;
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
}

function parseSkills(input) {
  const set = new Set();
  for (const s of input.split(',')) {
    const t = s.trim();
    if (t) set.add(t);
  }
  return Array.from(set);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mdToHtml(md) {
  let s = escapeHtml(md);
  s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>')
       .replace(/^## (.+)$/gm, '<h2>$1</h2>')
       .replace(/^### (.+)$/gm, '<h3>$1</h3>')
       .replace(/^- (.+)$/gm, '<li>$1</li>');
  s = s.replace(/(<li>[^]*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  s = s.replace(/\n/g, '<br>');
  return s;
}

module.exports = { parseYearMonth, parseSkills, escapeHtml, mdToHtml };