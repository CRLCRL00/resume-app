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

test('R109: wxml style attributes never span multiple lines (XML spec)', () => {
  // R109: 修复 R107 T3 implementer 写的 multi-line style="..." 属性
  // — WXML 严格模式报 `unexpected character \n` 在 style 跨行处
  // 此测试扫所有 wxml `style="..."` 属性, 断言 value 不含换行
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  // Match all `style="..."` attributes (greedy until closing quote)
  const styleMatches = src.match(/style="[^"]*"/g) || [];
  assert.ok(styleMatches.length > 0, 'R109: wxml 应该至少 1 个 style 属性');
  for (const m of styleMatches) {
    assert.ok(!m.includes('\n'),
      `R109: wxml style 属性不能跨行 — 发现: ${m.slice(0, 60)}... (WXML 不支持属性内换行)`);
  }
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
  assert.ok(src.includes('id="starfield-lines"'), 'wxml missing id');
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
  assert.ok(src.includes("createSelectorQuery"), 'js missing createSelectorQuery (R104 type=2d)');
  assert.ok(src.includes("getContext('2d')"), 'js missing getContext 2d (R104)');
  assert.ok(src.includes('strokeStyle'), 'js missing strokeStyle (R104)');
  assert.ok(src.includes('beginPath'), 'js missing beginPath');
  assert.ok(src.includes('_isFieldFilled(p.id)'), 'lines should only draw between filled particles');
});

test('R104: wxml canvas uses type="2d"', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  assert.ok(src.includes('type="2d"'), 'wxml canvas should use type=2d');
  assert.ok(src.includes('id="starfield-lines"'), 'wxml canvas id');
  assert.ok(!src.includes("canvas-id=\"starfield-lines\""), 'should NOT use old canvas-id (replaced by id for type=2d)');
});

test('R106: onSubmit shows modal when token is missing', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.js', 'utf8');
  assert.ok(src.includes('请先获取 Token'), 'js missing R106 token-missing prompt');
  assert.ok(src.includes('wx.getStorageSync(\'token\')'), 'js missing token storage check');
  assert.ok(src.includes('dev-reissue'), 'js missing dev-reissue hint');
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

test('R106b: wxml outer for-item ref uses renamed con.* not fallback item.*', () => {
  // R106b: 真机截图证明 5 个星座完全不渲染 — 根因是 wx:for-item="con"
  // 重命名后, 内部仍用 item.* 触发小程序解析歧义. 修法: 改用 con.*
  const fs = require('node:fs');
  const path = require('node:path');
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxml'), 'utf8');
  // 外层 for-item="con" 出现的 view 块内, 不能再出现 {{item.
  // 取出两段 wx:for 之间的内容
  const startIdx = wxml.indexOf('wx:for="{{constellations}}"');
  const endIdx = wxml.indexOf('</view>', wxml.indexOf('</view>', startIdx) + 1);
  const block = wxml.slice(startIdx, endIdx);
  // 找这段里所有的 {{item.xxx}} 引用（应当为空）
  const itemRefs = block.match(/\{\{item\.[a-zA-Z_]+\}\}/g) || [];
  assert.strictEqual(itemRefs.length, 0,
    `R106b: 外层 wx:for-item="con" 内仍有 {{item.*}} 引用: ${itemRefs.join(',')}. 必须用 {{con.*}}`);
});

test('R106b: wxml particle loop does not call _isFieldFilled inline (WXML 函数调用会断渲染)', () => {
  // R106b: 真机截图所有粒子也不显示 — 推测是 WXML inline function 触发异常
  // 修复: 用 particle.filled 替代 (js _refreshParticleFilled 提前算好)
  const fs = require('node:fs');
  const path = require('node:path');
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxml'), 'utf8');
  assert.ok(!wxml.includes('_isFieldFilled'),
    'R106b: WXML 不应再有 inline 函数调用 `_isFieldFilled()` — 实测在 IDE 触发整个星座 view 不渲染');
  assert.ok(wxml.includes('particle.filled'),
    'R106b: WXML 应该改用 {{particle.filled ? \'filled\' : \'\'}} 替代 inline 函数');
});

test('R106b: js layoutParticles output 每个粒子带 filled 字段 (false)', () => {
  // R106b: 兜底 — 数据层就应当预填 filled 字段 (避免 WXML inline 调用)
  const { layoutParticles } = require('../pages/form/bigscreen/bigscreen')._test;
  const result = layoutParticles(375, 667);
  const firstParticle = result[0].particles[0];
  assert.ok('filled' in firstParticle,
    'R106b: layoutParticles 输出的粒子必须有 filled 字段');
  assert.strictEqual(firstParticle.filled, false,
    'R106b: 初次 layoutParticle 时 filled 默认 false (form 没数据)');
});

test('R95: bigscreen.json title = 填简历', () => {
  const fs = require('node:fs');
  const cfg = JSON.parse(fs.readFileSync('./pages/form/bigscreen/bigscreen.json', 'utf8'));
  assert.strictEqual(cfg.navigationBarTitleText, '填简历');
});

// ─── R107 T1: 配色升级 (星云背景 + conic-gradient 双色) ─────────────
test('R107 T1: wxss has --theme-bg CSS variable using radial-gradient for starfield', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wxss = path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxss');
  const src = fs.readFileSync(wxss, 'utf8');
  assert.ok(src.includes('--theme-bg'),
    'R107 T1: wxss 必须定义 --theme-bg CSS 变量 (星云背景)');
  assert.ok(src.includes('var(--theme-bg'),
    'R107 T1: wxss 必须通过 var(--theme-bg) 引用 (保证可逆)');
  assert.ok(src.includes('radial-gradient'),
    'R107 T1: --theme-bg 必须用 radial-gradient (星云)');
});

test('R107 T1: wxss defines --c1/--c2 + conic-gradient on .constellation', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wxss = path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxss');
  const src = fs.readFileSync(wxss, 'utf8');
  assert.ok(src.includes('--c1'),
    'R107 T1: 必须定义 --c1 CSS 变量 (conic-gradient 颜色 1)');
  assert.ok(src.includes('--c2'),
    'R107 T1: 必须定义 --c2 CSS 变量 (conic-gradient 颜色 2)');
  assert.ok(src.includes('conic-gradient'),
    'R107 T1: .constellation 必须用 conic-gradient 双色填充');
  assert.ok(src.includes('var(--c1)') && src.includes('var(--c2)'),
    'R107 T1: conic-gradient 必须用 var(--c1)/var(--c2) 而非硬编码颜色');
});

test('R107 T1: wxml applies constellation--{{con.id}} modifier on outer view', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxml'), 'utf8');
  // 外层 wx:for="{{constellations}}" 块必须有 modifier class
  assert.ok(wxml.includes('constellation--{{con.id}}'),
    'R107 T1: wxml 必须在 wx:for-item="con" 内的外层 view 上加 constellation--{{con.id}} modifier class');
});

// ─── R107 T2: 中心完成度数字脉冲 + 阈值变色 ─────────────
test('R107 T2: wxss has @keyframes num-pulse + center-num animation', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wxss = path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxss');
  const src = fs.readFileSync(wxss, 'utf8');
  assert.ok(src.includes('@keyframes num-pulse'),
    'R107 T2: 中心数字脉冲 keyframe (@keyframes num-pulse)');
  assert.ok(/animation\s*:\s*num-pulse/.test(src),
    'R107 T2: .center-num 必须引用 num-pulse 动画');
});

test('R107 T2: wxss has tier-low / tier-mid / tier-high / tier-gold color classes', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wxss = path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxss');
  const src = fs.readFileSync(wxss, 'utf8');
  assert.ok(/\.center-num\.tier-low\b/.test(src) || /\.tier-low\b/.test(src),
    'R107 T2: 必须定义 .tier-low (完成度 < 30) 颜色');
  assert.ok(/\.tier-mid\b/.test(src),
    'R107 T2: 必须定义 .tier-mid (30 ≤ 完成度 < 60) 颜色');
  assert.ok(/\.tier-high\b/.test(src),
    'R107 T2: 必须定义 .tier-high (60 ≤ 完成度 < 100) 颜色');
  assert.ok(/\.tier-gold\b/.test(src),
    'R107 T2: 必须定义 .tier-gold (完成度 = 100) 颜色 + 光晕');
});

test('R107 T2: js has _applyCompletionBump helper with tier logic + bumpTick increment', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = path.join(__dirname, '../pages/form/bigscreen/bigscreen.js');
  const src = fs.readFileSync(js, 'utf8');
  assert.ok(src.includes('_applyCompletionBump'),
    'R107 T2: 必须实现 _applyCompletionBump() helper');
  // Tier thresholds: 100 → gold, 60 → high, 30 → mid, else low
  assert.ok(src.includes('>= 100') || src.includes('=== 100'),
    'R107 T2: 必须判断 100% 阈值 (gold)');
  assert.ok(src.includes('>= 60'),
    'R107 T2: 必须判断 60% 阈值 (high)');
  assert.ok(src.includes('>= 30'),
    'R107 T2: 必须判断 30% 阈值 (mid)');
  assert.ok(src.includes('bumpTick'),
    'R107 T2: 必须维护 bumpTick (触发 CSS animation 重新运行)');
});

test('R107 T2: js data initializer has numTier + bumpTick fields', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = path.join(__dirname, '../pages/form/bigscreen/bigscreen.js');
  const src = fs.readFileSync(js, 'utf8');
  assert.ok(/numTier\s*:\s*['"]\w+['"]/.test(src),
    'R107 T2: data() 必须初始化 numTier (字符串, 默认 low)');
  assert.ok(/bumpTick\s*:\s*\d+/.test(src),
    'R107 T2: data() 必须初始化 bumpTick (数字, 默认 0)');
});

test('R107 T2 fix: wxml center-num binds tier class via numTier', () => {
  const fs = require('node:fs');
  const wxml = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  assert.ok(wxml.includes('center-num') && wxml.includes('numTier'),
    'R107 T2 fix: wxml 必须把 numTier 绑定到 center-num 的 class');
  assert.ok(/center-num[^"]*numTier/.test(wxml) || wxml.includes("'tier-' + numTier"),
    'R107 T2 fix: wxml 必须用 tier-{{numTier}} 或类似表达式');
});

// ─── R107 T3: 背景流星雨 (5 颗拖尾) ─────────────
test('R107 T3: js exports genMeteors producing 5 meteors with delay/duration', () => {
  const { genMeteors } = require('../pages/form/bigscreen/bigscreen')._test;
  const meteors = genMeteors(5, 750, 1200);
  assert.strictEqual(meteors.length, 5);
  for (const m of meteors) {
    assert.ok('delay' in m, 'R107 T3: 流星必须有 delay');
    assert.ok('duration' in m, 'R107 T3: 流星必须有 duration');
    assert.ok(m.duration >= 800 && m.duration <= 2000, 'R107 T3: 流星持续时间合理');
  }
});

test('R107 T3: wxml has meteor node template', () => {
  const fs = require('node:fs');
  const wxml = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  assert.ok(wxml.includes('wx:for="{{meteors}}"'), 'R107 T3: WXML 必须循环 meteors');
  assert.ok(wxml.includes('class="meteor"'), 'R107 T3: 必须用 class="meteor"');
});

test('R107 T3: wxss has meteor-fall keyframe with translate', () => {
  const fs = require('node:fs');
  const wxss = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  assert.ok(wxss.includes('@keyframes meteor-fall'), 'R107 T3: 流星坠落 keyframe');
  assert.ok(wxss.includes('translate'), 'R107 T3: 流星必须 transform 平移');
});

// ─── R107 T4: ≥80% 自动旋转 + 100% 庆祝 ─────────────
test('R107 T4: wxss has spin-slow + explode keyframes', () => {
  const fs = require('node:fs');
  const wxss = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  assert.ok(wxss.includes('@keyframes spin-slow'), 'R107 T4: 旋转 keyframe');
  assert.ok(wxss.includes('@keyframes explode'), 'R107 T4: 爆炸 keyframe');
});

test('R107 T4: js _watchCompletionTier handles 80/100 thresholds', () => {
  const fs = require('node:fs');
  const js = fs.readFileSync('./pages/form/bigscreen/bigscreen.js', 'utf8');
  assert.ok(js.includes('_watchCompletionTier'), 'R107 T4: 必须实现 _watchCompletionTier');
  assert.ok(js.includes('>= 80'), 'R107 T4: 必须判断 80% 阈值');
  assert.ok(js.includes('>= 100') || js.includes('=== 100'),
    'R107 T4: 必须判断 100% 阈值');
});

test('R107 T4: wxml starfield has ready/celebrate class bindings', () => {
  const fs = require('node:fs');
  const wxml = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  // Find the starfield opening tag (line 6-7)
  assert.ok(wxml.includes('starfieldReady'), 'R107 T4: wxml 必须用 starfieldReady');
  assert.ok(wxml.includes('starfieldCelebrate'), 'R107 T4: wxml 必须用 starfieldCelebrate');
});

// ─── R107 T5: 背景星云 (CSS-only ::before + blur) ─────────────
test('R107 T5: wxss has starfield::before + nebula-blur background', () => {
  const fs = require('node:fs');
  const wxss = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  assert.ok(wxss.includes('.starfield::before'), 'R107 T5: 必须用 pseudoelement ::before');
  assert.ok(wxss.includes('filter: blur'), 'R107 T5: 必须用模糊滤镜');
});

// ─── R108 T1: 星座呼吸 (CSS only + 嵌套 wrapper 解决 transform 冲突) ─────────────
test('R108 T1: wxss has constellation-breathe keyframe + applied to .constellation', () => {
  const fs = require('node:fs');
  const wxss = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  assert.ok(wxss.includes('@keyframes constellation-breathe'), 'R108 T1: 呼吸 keyframe');
  assert.ok(wxss.includes('constellation-breathe'), 'R108 T1: 应用到 .constellation');
});

test('R108 T1: wxml wraps constellation content in constellation-rotate div', () => {
  const fs = require('node:fs');
  const wxml = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  assert.ok(wxml.includes('constellation-rotate'), 'R108 T1: 必须用嵌套 wrapper 解决 transform 冲突');
  const cIdx = wxml.indexOf('constellation constellation--');
  const rIdx = wxml.indexOf('constellation-rotate');
  assert.ok(rIdx > cIdx, 'R108 T1: constellation-rotate 必须在 .constellation 内');
});

test('R108 T1: wxss 改 R107 T4 rotate 选择器到 constellation-rotate (避免冲突)', () => {
  const fs = require('node:fs');
  const wxss = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  assert.ok(wxss.includes('.starfield.ready .constellation-rotate'),
    'R108 T1: R107 T4 spin-slow 必须改用内层 constellation-rotate, 不与外层 scale 冲突');
  assert.ok(!wxss.includes('.starfield.ready .constellation {'),
    'R108 T1: R107 T4 不应再单独作用于 .constellation (会与 scale 冲突)');
});

// ─── R108 T2: 粒子拖尾 (touchmove + setData dx/dy) ─────────────
test('R108 T2: wxss has particle transform transition', () => {
  const fs = require('node:fs');
  const wxss = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  assert.ok(wxss.includes('.particle') && wxss.includes('transition'),
    'R108 T2: 粒子必须有 transition');
});

test('R108 T2: wxml starfield has touch event handlers', () => {
  const fs = require('node:fs');
  const wxml = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  // R108 T2 fix v2: 用 catchtouchmove (不是 bindtouchmove) 避免 bind+catch 冲突
  assert.ok(wxml.includes('catchtouchmove'), 'R108 T2: starfield 必须监听 touchmove (用 catchtouchmove)');
  assert.ok(wxml.includes('bindtouchend'), 'R108 T2: starfield 必须监听 touchend');
});

test('R108 T2: js has _onTouchMove handler + fingerPos data field', () => {
  const fs = require('node:fs');
  const js = fs.readFileSync('./pages/form/bigscreen/bigscreen.js', 'utf8');
  assert.ok(js.includes('_onTouchMove') || js.includes('onTouchMove'),
    'R108 T2: 必须实现 touchmove handler');
  assert.ok(js.includes('fingerPos'), 'R108 T2: data() 必须有 fingerPos');
});

test('R108 T2 fix: wxml starfield has starfieldTouching class binding', () => {
  const fs = require('node:fs');
  const wxml = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  assert.ok(wxml.includes('starfieldTouching'),
    'R108 T2 fix: wxml 必须用 starfieldTouching class 触发 .touching 状态');
});

test('R108 T2 fix v2: wxss .starfield.touching .particle REMOVES float animation (animation: none)', () => {
  const fs = require('node:fs');
  const wxss = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  // Use regex to find the .starfield.touching .particle { ... } block specifically
  const match = wxss.match(/\.starfield\.touching\s+\.particle\s*\{[^}]*\}/);
  assert.ok(match, 'R108 T2 fix v2: 必须有 .starfield.touching .particle { ... } 规则块');
  const block = match[0];
  // CRITICAL: must use `animation: none` (NOT animation-play-state: paused, which doesn't release transform per CSS spec)
  assert.ok(block.includes('animation: none'),
    'R108 T2 fix v2: 必须用 animation: none (paused 不行, 动画仍冻结 transform)');
  assert.ok(!block.includes('animation-play-state'),
    'R108 T2 fix v2: 不应该用 animation-play-state (CSS spec 不释放 transform)');
});

test('R108 T2 fix: .particle transition is on .particle block (not .particle-glow)', () => {
  const fs = require('node:fs');
  const wxss = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  // Use regex to find .particle { ... transition: transform ... } block
  const particleBlock = wxss.match(/\.particle\s*\{[^}]*\}/);
  assert.ok(particleBlock, 'R108 T2 fix: 必须有 .particle { ... } 规则块');
  assert.ok(particleBlock[0].includes('transition: transform'),
    'R108 T2 fix: .particle { } 块必须包含 `transition: transform` (不是 all)');
});

test('R108 T2 fix v2: wxml starfield uses catchtouchmove (not bind + empty catch)', () => {
  const fs = require('node:fs');
  const wxml = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  // Should have catchtouchmove="onTouchMove" (single binding)
  assert.ok(wxml.includes('catchtouchmove="onTouchMove"'),
    'R108 T2 fix v2: 必须用 catchtouchmove="onTouchMove" (不是 bind + 空 catch)');
  // Should NOT have bindtouchmove (avoids bind+catch conflict)
  assert.ok(!wxml.includes('bindtouchmove'),
    'R108 T2 fix v2: 不应再有 bindtouchmove (会与 catchtouchmove 冲突)');
});

// ─── R112 T1: 星座轨道外移 (orbitR 0.32→0.40) ─────────────
test('R112 T1: layoutParticles orbitR coefficient = 0.40 (was 0.32, mobile overlap fix)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.js'), 'utf8');
  // 必须用 0.40 系数 (手机 0 重叠 = 150-90)
  assert.ok(/orbitR\s*=\s*Math\.min\([^)]+\)\s*\*\s*0\.40/.test(src),
    'R112 T1: layoutParticles 必须用 0.40 系数 (避免手机 5 星座压中心)');
  // 必须不再用旧的 0.32 或中间值 0.38 (后者经 T1.5 验证仍有 7.5px 重叠)
  assert.ok(!/orbitR\s*=\s*Math\.min\([^)]+\)\s*\*\s*0\.32/.test(src),
    'R112 T1: 不应再用 0.32 (手机 50px 重叠)');
  assert.ok(!/orbitR\s*=\s*Math\.min\([^)]+\)\s*\*\s*0\.38/.test(src),
    'R112 T1: 不应再用 0.38 (T1.5 验证仍有 7.5px 重叠)');
});

// ─── R112 T1.5: 行为测试 — 5 星座粒子不撞中心圆 (手机 375×667) ─────────────
test('R112 T1.5: layoutParticles(375, 667) 每个粒子离画面中心 ≥ 60px (中心圆半径)', () => {
  const { layoutParticles } = require('../pages/form/bigscreen/bigscreen')._test;
  const cs = layoutParticles(375, 667);
  const cx = 375 / 2, cy = 667 / 2;
  const CENTER_R = 60;
  for (const c of cs) {
    for (const p of c.particles) {
      const dist = Math.hypot(p.x - cx, p.y - cy);
      assert.ok(dist >= CENTER_R,
        `R112 T1.5: 粒子 ${c.id}/${p.id} 离画面中心 ${dist.toFixed(1)}px < ${CENTER_R}px — 撞中心圆!`);
    }
  }
});

// ─── R112 T2: 中心节点缩小 25% (WXML inline + WXSS 5 处 rpx) ─────────────
test('R112 T2: wxml center-node inline offset = width/2 - 60 (was 80)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxml'), 'utf8');
  assert.ok(/left:\s*\{\{width\s*\/\s*2\s*-\s*60\}\}px/.test(src),
    'R112 T2: wxml center-node left 偏移必须 -60px (从 -80 缩)');
  assert.ok(/top:\s*\{\{height\s*\/\s*2\s*-\s*60\}\}px/.test(src),
    'R112 T2: wxml center-node top 偏移必须 -60px');
  assert.ok(!/left:\s*\{\{width\s*\/\s*2\s*-\s*80\}\}px/.test(src),
    'R112 T2: 不应再用 -80 偏移');
});

test('R112 T2: wxss 中心节点尺寸按比例缩小 (5 处 rpx)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxss'), 'utf8');
  // .center-node 容器 160 → 120rpx
  const cn = src.match(/\.center-node\s*\{[^}]*\}/);
  assert.ok(cn && /width:\s*120rpx/.test(cn[0]) && /height:\s*120rpx/.test(cn[0]),
    'R112 T2: .center-node 容器必须 120×120rpx (从 160×160)');
  // .center-pulse 200 → 150rpx
  const cp = src.match(/\.center-pulse\s*\{[^}]*\}/);
  assert.ok(cp && /width:\s*150rpx/.test(cp[0]) && /height:\s*150rpx/.test(cp[0]),
    'R112 T2: .center-pulse 光晕必须 150×150rpx (从 200×200)');
  // .center-circle 140 → 100rpx
  const cc = src.match(/\.center-circle\s*\{[^}]*\}/);
  assert.ok(cc && /width:\s*100rpx/.test(cc[0]) && /height:\s*100rpx/.test(cc[0]),
    'R112 T2: .center-circle 实圆必须 100×100rpx (从 140×140)');
  // .center-num 56 → 44rpx
  const num = src.match(/\.center-num\s*\{[^}]*\}/);
  assert.ok(num && /font-size:\s*44rpx/.test(num[0]),
    'R112 T2: .center-num 字号必须 44rpx (从 56rpx)');
  // .center-label margin-top 12 → 8rpx
  const lbl = src.match(/\.center-label\s*\{[^}]*\}/);
  assert.ok(lbl && /margin-top:\s*8rpx/.test(lbl[0]),
    'R112 T2: .center-label margin-top 必须 8rpx (从 12rpx)');
});

// ─── R113: WXML opening tag 不跨多行 attribute (IDE 真机严格模式) ─────────────
test('R113: wxml opening tags never span multiple lines (attribute 跨行 IDE 报 unexpected character \\n)', () => {
  // R113 教训: R109 只抓 style 内 \n, 但 IDE 严格模式连 `<tag attr1="\n attr2="...">` 都会报
  // (line 22:0 unexpected character `\n` 是 <canvas> 5 行 attribute 块触发)
  // 修法: 任何 `<tag` 开头到 `>` 闭合之间的 attribute 必须全在同一物理行
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxml'), 'utf8');
  const lines = src.split('\n');
  // 跟踪 "开放的 tag" (已遇到 `<tag` 但还没遇到 `>`)
  let openTag = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hasOpen = /<[a-zA-Z][\w-]*\s/.test(line) || /<[a-zA-Z][\w-]*\s*$/.test(line);
    const hasClose = />/.test(line);
    if (openTag && /^\s+[a-zA-Z][\w-]*=/.test(line)) {
      // 上一个 tag 还开着, 这一行又出现 attribute — 跨行 attribute 块!
      assert.fail(`R113: wxml line ${i + 1} 有 attribute 跨行 (上一个 tag 来自 line ${openTag.line}): "${line.trim()}"`);
    }
    if (hasOpen && !hasClose) {
      // 新 tag 跨行
      openTag = { line: i + 1, text: line.trim() };
    } else if (hasClose) {
      openTag = null;
    }
  }
  // 测试通过 = 上面 assert.fail 没触发
  assert.ok(true, 'R113: 所有 wxml opening tag 都是单行');
});

// ─── R114 T2: modal 多轮 AI 对话改造 ─────────────
test('R114 T2: wxml modal has ai-chat-history + ai-followup + ai-suggestion-chip elements', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxml'), 'utf8');
  assert.ok(src.includes('ai-chat-history'), 'R114 T2: wxml modal 必有 ai-chat-history 多轮对话区');
  assert.ok(src.includes('ai-followup'), 'R114 T2: wxml modal 必有 ai-followup 追问气泡');
  assert.ok(src.includes('ai-suggestion-chip'), 'R114 T2: wxml modal 必有 ai-suggestion-chip AI 建议 chip');
});

test('R114 T2: js has _aiSuggest + debounced onModalInput + aiBusy state', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.js'), 'utf8');
  assert.ok(src.includes('_aiSuggest'),
    'R114 T2: js 必有 _aiSuggest() 调用 /api/ai/assist-field');
  assert.ok(src.includes('aiBusy'),
    'R114 T2: js data 必有 aiBusy 状态 (防重入)');
  assert.ok(/setTimeout|debounce/.test(src),
    'R114 T2: js 必有 setTimeout / debounce 防 LLM 风暴');
});

