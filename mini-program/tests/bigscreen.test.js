/**
 * R94 bigscreen — 大屏填简历 unit tests
 *
 * Tests:
 *   - emptyForm() 初始化
 *   - calcCompletion() 加权累计
 *   - 步骤常量
 *   - form.js 入口函数存在
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

test('R94: emptyForm returns all-empty initial state', () => {
  const { emptyForm } = require('../pages/form/bigscreen/bigscreen')._test;
  const f = emptyForm();
  assert.strictEqual(f.name, '');
  assert.strictEqual(f.gender, '');
  assert.strictEqual(f.degree, '');
  assert.strictEqual(f.phone, '');
  assert.strictEqual(f.educations.length, 1);
  assert.strictEqual(f.educations[0].school, '');
  assert.strictEqual(f.experiences.length, 1);
  assert.strictEqual(f.experiences[0].company, '');
  assert.strictEqual(f.expected.city, '');
  assert.deepStrictEqual(f.skills, []);
});

test('R94: calcCompletion empty form = 0', () => {
  const { emptyForm, calcCompletion } = require('../pages/form/bigscreen/bigscreen')._test;
  assert.strictEqual(calcCompletion(emptyForm(), 0), 0);
});

test('R94: calcCompletion with full basic info = 25', () => {
  const { emptyForm, calcCompletion } = require('../pages/form/bigscreen/bigscreen')._test;
  const f = emptyForm();
  f.name = '张三';
  f.gender = 'male';
  f.degree = '本科';
  f.phone = '13800000000';
  assert.strictEqual(calcCompletion(f, 0), 25);
});

test('R94: calcCompletion with full basic + education = 45', () => {
  const { emptyForm, calcCompletion } = require('../pages/form/bigscreen/bigscreen')._test;
  const f = emptyForm();
  f.name = '张三'; f.gender = 'male'; f.degree = '本科'; f.phone = '13800000000';
  f.educations[0].school = '清华';
  f.educations[0].major = 'CS';
  f.educations[0].start = '2020-09';
  f.educations[0].end = '2024-06';
  assert.strictEqual(calcCompletion(f, 0), 45);
});

test('R94: calcCompletion with all filled = 100', () => {
  const { emptyForm, calcCompletion } = require('../pages/form/bigscreen/bigscreen')._test;
  const f = emptyForm();
  f.name = '张三'; f.gender = 'male'; f.degree = '本科'; f.phone = '13800000000';
  f.educations[0].school = '清华';
  f.educations[0].major = 'CS';
  f.educations[0].start = '2020-09';
  f.educations[0].end = '2024-06';
  f.experiences[0].company = '阿里';
  f.experiences[0].title = '前端';
  f.experiences[0].start = '2021-07';
  f.experiences[0].end = '至今';
  f.experiences[0].desc = '负责 xxx';
  f.expected.city = '深圳';
  f.expected.position = '全栈';
  f.expected.salary_min = '15';
  f.expected.salary_max = '25';
  assert.strictEqual(calcCompletion(f, 3), 100);
});

test('R94: calcCompletion cap at 100', () => {
  const { emptyForm, calcCompletion } = require('../pages/form/bigscreen/bigscreen')._test;
  const f = emptyForm();
  f.name = 'X'; f.skills = ['a', 'b', 'c'];
  const r = calcCompletion(f, 3);
  assert.ok(r <= 100, `should cap at 100, got ${r}`);
});

test('R98: STEP_LABELS derived from CONSTELLATIONS (5 stars)', () => {
  const { STEP_LABELS, CONSTELLATIONS } = require('../pages/form/bigscreen/bigscreen')._test;
  assert.strictEqual(STEP_LABELS.length, 5);
  assert.deepStrictEqual(STEP_LABELS, CONSTELLATIONS.map(c => c.name));
});

test('R98: CONSTELLATIONS has 5 star systems covering all form steps', () => {
  const { CONSTELLATIONS } = require('../pages/form/bigscreen/bigscreen')._test;
  assert.strictEqual(CONSTELLATIONS.length, 5);
  // Each constellation must have a color + ≥1 field
  for (const c of CONSTELLATIONS) {
    assert.ok(c.color && c.color.startsWith('#'), `${c.id} missing color`);
    assert.ok(Array.isArray(c.fields) && c.fields.length > 0, `${c.id} missing fields`);
  }
  // Field IDs across all constellations cover all form data fields
  const ids = new Set();
  for (const c of CONSTELLATIONS) for (const f of c.fields) ids.add(f.id);
  for (const required of ['name', 'gender', 'degree', 'edu_school', 'edu_major', 'work_company', 'exp_city']) {
    assert.ok(ids.has(required), `missing field id: ${required}`);
  }
});

test('R98: layoutParticles produces 5 constellations at orbit positions', () => {
  const { layoutParticles } = require('../pages/form/bigscreen/bigscreen')._test;
  const cs = layoutParticles(750, 1200);
  assert.strictEqual(cs.length, 5);
  // All constellation centers should be within canvas bounds
  for (const c of cs) {
    assert.ok(c.cx > 0 && c.cx < 750, `cx out of bounds: ${c.cx}`);
    assert.ok(c.cy > 0 && c.cy < 1200, `cy out of bounds: ${c.cy}`);
    assert.ok(c.particles.length > 0, 'no particles');
    // Particles should be near constellation center
    for (const p of c.particles) {
      const dist = Math.hypot(p.x - c.cx, p.y - c.cy);
      assert.ok(dist < 100, `particle too far from constellation: dist=${dist}`);
    }
  }
});

test('R98: genBackgroundStars produces deterministic stars', () => {
  const { genBackgroundStars } = require('../pages/form/bigscreen/bigscreen')._test;
  const a = genBackgroundStars(50, 750, 1200);
  const b = genBackgroundStars(50, 750, 1200);
  assert.strictEqual(a.length, 50);
  assert.deepStrictEqual(a, b, 'should be deterministic with same seed');
  // All within bounds
  for (const s of a) {
    assert.ok(s.x >= 0 && s.x < 750);
    assert.ok(s.y >= 0 && s.y < 1200);
  }
});

test('R98: wxml has starfield + particle + modal markup', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  assert.ok(src.includes('starfield'), 'wxml missing starfield container');
  assert.ok(src.includes('particle'), 'wxml missing particle class');
  assert.ok(src.includes('bg-star'), 'wxml missing bg-star');
  assert.ok(src.includes('center-node'), 'wxml missing center-node');
  assert.ok(src.includes('const-halo'), 'wxml missing constellation halo');
  assert.ok(src.includes('floating-preview'), 'wxml missing floating-preview');
  assert.ok(src.includes('modal-card'), 'wxml missing modal-card');
  assert.ok(src.includes('onParticleTap'), 'wxml missing onParticleTap');
  assert.ok(!src.includes('msg-bubble'), 'wxml should NOT have chat bubbles');
});

test('R98: wxss has dark space + glowing particles', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  assert.ok(src.includes('.starfield'), 'wxss missing starfield');
  assert.ok(src.includes('.bg-star'), 'wxss missing bg-star');
  assert.ok(src.includes('.particle-core'), 'wxss missing particle-core');
  assert.ok(src.includes('radial-gradient'), 'wxss should use radial gradients');
  assert.ok(src.includes('box-shadow'), 'wxss should use glow shadows');
  assert.ok(src.includes('@keyframes'), 'wxss should have animations');
  assert.ok(src.includes('#050810') || src.includes('radial-gradient(ellipse'), 'wxss should have dark space bg');
  assert.ok(!src.includes('.msg-bubble'), 'wxss should NOT have chat bubble styles');
});

test('R98: js has constellation + modal + particle tap logic', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.js', 'utf8');
  assert.ok(src.includes('CONSTELLATIONS'), 'js missing CONSTELLATIONS');
  assert.ok(src.includes('layoutParticles'), 'js missing layoutParticles');
  assert.ok(src.includes('onParticleTap'), 'js missing onParticleTap');
  assert.ok(src.includes('onModalSave'), 'js missing onModalSave');
  assert.ok(src.includes('_saveModal'), 'js missing _saveModal');
  assert.ok(src.includes('modalVisible'), 'js missing modalVisible');
});

test('R99: every field has ai prompt (chat + starfield fusion)', () => {
  const { CONSTELLATIONS } = require('../pages/form/bigscreen/bigscreen')._test;
  let totalFields = 0;
  let fieldsWithAi = 0;
  for (const c of CONSTELLATIONS) {
    for (const f of c.fields) {
      totalFields++;
      assert.ok(f.ai && f.ai.length > 0, `field ${c.id}/${f.id} missing ai prompt`);
      fieldsWithAi++;
    }
  }
  assert.strictEqual(fieldsWithAi, totalFields, 'all fields must have ai prompt');
  assert.ok(totalFields >= 14, 'expected ≥14 fields');
});

test('R99: modal state includes ai + label + placeholder', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.js', 'utf8');
  assert.ok(src.includes('modalFieldAi'), 'js missing modalFieldAi state');
  assert.ok(src.includes('modalFieldLabel'), 'js missing modalFieldLabel state');
  assert.ok(src.includes('modalPlaceholder'), 'js missing modalPlaceholder state');
  assert.ok(src.includes('modalConstColor'), 'js missing modalConstColor state');
});

test('R99: wxml modal has ai-bubble markup', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  assert.ok(src.includes('modal-ai-bubble'), 'wxml missing modal-ai-bubble');
  assert.ok(src.includes('modal-ai-avatar'), 'wxml missing modal-ai-avatar');
  assert.ok(src.includes('modal-ai-text'), 'wxml missing modal-ai-text');
  assert.ok(src.includes('modalFieldAi'), 'wxml missing modalFieldAi bind');
});

test('R99: wxss has ai bubble styles (no chat-bubble leftovers)', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  assert.ok(src.includes('.modal-ai-bubble'), 'wxss missing .modal-ai-bubble');
  assert.ok(src.includes('.modal-ai-avatar'), 'wxss missing .modal-ai-avatar');
  assert.ok(src.includes('.modal-ai-text'), 'wxss missing .modal-ai-text');
  assert.ok(src.includes('border-left'), 'wxss should use border-left accent');
  assert.ok(!src.includes('.msg-bubble'), 'wxss should NOT have leftover chat bubble');
});

test('R103: wxml has canvas for line drawing', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  assert.ok(src.includes('canvas-id="starfield-lines"'), 'wxml missing canvas-id');
  assert.ok(src.includes('class="lines-canvas"'), 'wxml missing lines-canvas class');
  assert.ok(src.includes('disable-scroll="true"'), 'canvas should disable scroll');
});

test('R103: wxss has canvas + particle float animation', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  assert.ok(src.includes('.lines-canvas'), 'wxss missing .lines-canvas');
  assert.ok(src.includes('pointer-events: none'), 'canvas should not block clicks');
  assert.ok(src.includes('@keyframes float'), 'wxss missing float animation');
  assert.ok(src.includes('animation: float'), 'particle should animate');
  assert.ok(src.includes('translate'), 'float should use translate');
});

test('R103: js has _drawLines method using Canvas API', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.js', 'utf8');
  assert.ok(src.includes('_drawLines'), 'js missing _drawLines');
  assert.ok(src.includes("createCanvasContext('starfield-lines'"), 'js missing canvas context');
  assert.ok(src.includes('setStrokeStyle'), 'js missing stroke style');
  assert.ok(src.includes('beginPath'), 'js missing beginPath');
  assert.ok(src.includes('_isFieldFilled(p.id)'), 'lines should only draw between filled particles');
});

test('R95: form (mobile version) is removed', () => {
  const fs = require('node:fs');
  assert.ok(!fs.existsSync('./pages/form/form.js'), 'form/form.js should be removed');
  assert.ok(!fs.existsSync('./pages/form/form.wxml'), 'form/form.wxml should be removed');
  assert.ok(!fs.existsSync('./pages/form/form.wxss'), 'form/form.wxss should be removed');
  assert.ok(!fs.existsSync('./pages/form/form.json'), 'form/form.json should be removed');
});

test('R95: index.js goForm routes to bigscreen', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/index/index.js', 'utf8');
  assert.ok(src.includes('goForm'), 'index.js missing goForm');
  assert.ok(
    src.includes("/pages/form/bigscreen/bigscreen"),
    'index.js goForm should route to bigscreen'
  );
});

test('R95: app.json no longer references form/form', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./app.json', 'utf8');
  assert.ok(
    !src.match(/pages\/form\/form[^/]/),
    'app.json should not list pages/form/form'
  );
  assert.ok(
    src.includes('pages/form/bigscreen/bigscreen'),
    'app.json missing bigscreen route'
  );
});

test('R95: bigscreen.json title = 填简历', () => {
  const fs = require('node:fs');
  const cfg = JSON.parse(fs.readFileSync('./pages/form/bigscreen/bigscreen.json', 'utf8'));
  assert.strictEqual(cfg.navigationBarTitleText, '填简历');
});