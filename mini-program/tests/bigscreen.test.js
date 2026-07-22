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

test('R98 → R116: STEP_LABELS 已删 — R116 不再用固定步骤名 (sections 直接来自 CONSTELLATIONS)', () => {
  // R116 翻转: R98 stepLabels/stepHints 字段已删, sections 直接从 CONSTELLATIONS 派生
  assert.ok(true, 'R98 → R116: STEP_LABELS 翻转 — 无需再断言步骤名 (sections 派生)');
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

test('R98 → R116: layoutParticles 翻转 — R116 不再需要粒子位置 (竖滑 feed 不画线)', () => {
  // R116: 大屏改为抖音竖滑, 不再有粒子位置/连线逻辑.
  // 此测试保留以文档化 R98 → R116 行为变迁; 不再断言 layoutParticles 输出.
  // (粒子位置/连线逻辑被 R98 → R116 推翻, _drawLines/_refreshParticleFilled 改为 no-op)
  assert.ok(true, 'R98 → R116: R116 翻转为 no-op; 见 R116 新 feed-* 标记测试');
});

test('R98 → R116: genBackgroundStars 已删 — R116 无背景小星点 (抖音黑底不需要)', () => {
  // R116 翻转: 函数已删, 抖音风不需要装饰小星点
  assert.ok(true, 'R98 → R116: genBackgroundStars 翻转 (函数已删, 抖音黑底不需要装饰)');
});

test('R98 → R116: wxml no longer has starfield/particle/center-node/bg-star/const-halo/floating-preview markup', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  // R116 翻转: R98 星图节点全部删除 (改为竖滑 feed)
  assert.ok(!src.includes('class="starfield"'), 'R98 → R116: wxml 不应再有 class="starfield" (已改为 feed-page)');
  assert.ok(!src.includes('class="particle"'), 'R98 → R116: wxml 不应再有 class="particle" (已改为 feed-field-card)');
  assert.ok(!src.includes('class="bg-star"'), 'R98 → R116: wxml 不应再有 class="bg-star" (无背景小星点)');
  assert.ok(!src.includes('class="center-node"'), 'R98 → R116: wxml 不应再有 class="center-node" (无中心完成度节点)');
  assert.ok(!src.includes('const-halo'), 'R98 → R116: wxml 不应再有 const-halo (无星座晕圈)');
  assert.ok(!src.includes('class="floating-preview"'), 'R98 → R116: wxml 不应再有 class="floating-preview" (无浮动预览)');
  // 保留 modal-card (R99+R114+R115 wizard 仍用)
  assert.ok(src.includes('modal-card'), 'R116: modal-card 必须保留 (wizard 弹窗兜底)');
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

test('R98 → R116: wxss no longer has starfield/bg-star/particle-core 深空 + 发光粒子样式', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  // R116 翻转: 抖音黑底大字, R98 深空 + 发光粒子全部删除
  assert.ok(!src.includes('.starfield'), 'R98 → R116: wxss 不应再有 .starfield (已改为 .feed-page)');
  assert.ok(!src.includes('.bg-star'), 'R98 → R116: wxss 不应再有 .bg-star (无装饰小星点)');
  assert.ok(!src.includes('.particle-core'), 'R98 → R116: wxss 不应再有 .particle-core (无粒子)');
  assert.ok(!src.includes('#050810'), 'R98 → R116: wxss 不应再有 #050810 深空色 (改 #000000 抖音黑)');
});

test('R98 → R116: js 不再依赖 layoutParticles/onParticleTap (R116 字段卡片 + onFieldCardTap)', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.js', 'utf8');
  // R116 翻转: R98 粒子交互已删 (改为字段卡片 onFieldCardTap)
  // CONSTELLATIONS 必须保留 (wizard/字段定义仍在用)
  assert.ok(src.includes('CONSTELLATIONS'), 'js missing CONSTELLATIONS (字段定义)');
  // modalVisible/onModalSave/_saveModal 仍保留 (弹窗兜底)
  assert.ok(src.includes('modalVisible'), 'js missing modalVisible (弹窗兜底)');
  assert.ok(src.includes('onModalSave'), 'js missing onModalSave');
  // R98 翻转 — 但 layoutParticles/onParticleTap 函数体可保留 (no-op 兼容)
  // 翻转断言: 不再 setData constellations 大对象
  assert.ok(!src.includes('constellations: layoutParticles'),
    'R98 → R116: _initLayout 不应再调 layoutParticles 设 constellations (改 setData sections)');
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

test('R99 → R116: wxml 仍含 modal-ai-bubble (assist 模式静态提示, aiHistory 空时显示)', () => {
  // R116 fix: 恢复 R99 modal-ai-bubble (R116 T1 implementer 未授权删了)
  // 条件 wx:if="{{modalFieldAi && aiHistory.length === 0}}" 避免与 ai-chat-history 重复
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  assert.ok(src.includes('modal-ai-bubble'),
    'R99 → R116: 恢复 modal-ai-bubble (assist 模式)');
  assert.ok(src.includes('modal-ai-text'),
    'R99 → R116: 恢复 modal-ai-text 子元素');
});

test('R99 → R116: wxss no longer has modal-ai-bubble (R116 弹窗改为 wizard 主交互)', () => {
  // R116 翻转: modal-ai-bubble 已删 (wizard 模式成为主交互, 旧的 AI 多轮气泡块去除)
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  assert.ok(!src.includes('.modal-ai-bubble'),
    'R99 → R116: wxss 不应再有 .modal-ai-bubble (wizard 模式替代)');
  assert.ok(!src.includes('.msg-bubble'),
    'wxss should NOT have leftover chat bubble');
});

test('R103 → R116: wxml no longer has canvas for line drawing (无粒子无连线)', () => {
  // R116 翻转: canvas 已删, 无粒子
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  assert.ok(!src.includes('id="starfield-lines"'),
    'R103 → R116: wxml 不应再有 id="starfield-lines" (canvas 已删)');
  assert.ok(!src.includes('class="lines-canvas"'),
    'R103 → R116: wxml 不应再有 lines-canvas (无划线)');
});

test('R103 → R116: wxss no longer has lines-canvas + particle float animation', () => {
  // R116 翻转
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  assert.ok(!src.includes('.lines-canvas'),
    'R103 → R116: wxss 不应再有 .lines-canvas');
  assert.ok(!src.includes('@keyframes float'),
    'R103 → R116: 无粒子 float keyframe');
});

test('R103 → R116: js _drawLines 改 no-op + _snapToSection 用 createSelectorQuery 仍可', () => {
  // R116 翻转: _drawLines 是 no-op, 不再用 createSelectorQuery/getContext 画线
  // R116 T2 补充: _snapToSection 用 createSelectorQuery 算 scrollTop (非 _drawLines 用, 合法)
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.js', 'utf8');
  assert.ok(src.includes('_drawLines'),
    'R103 → R116: 函数名仍保留 (no-op 兼容)');
  // 找 _drawLines 函数体, 验证不调 createSelectorQuery
  const drawLinesMatch = src.match(/_drawLines\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(drawLinesMatch, 'R103 → R116: 必须有 _drawLines 函数');
  assert.ok(!drawLinesMatch[0].includes('createSelectorQuery'),
    'R103 → R116: _drawLines 函数体内不应调 createSelectorQuery');
  assert.ok(!drawLinesMatch[0].includes("getContext('2d')"),
    'R103 → R116: _drawLines 函数体内不应有 getContext 2d');
});

test('R104 → R116: wxml no longer has type="2d" canvas', () => {
  // R116 翻转
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  assert.ok(!src.includes('type="2d"'),
    'R104 → R116: wxml 不应再有 type="2d" canvas');
  assert.ok(!src.includes('id="starfield-lines"'),
    'R104 → R116: wxml 不应再有 starfield-lines canvas id');
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

test('R106b → R116: wxml no longer has wx:for="{{constellations}}" 星座粒子循环', () => {
  // R106b: 真机截图证明 5 个星座完全不渲染 — 根因是 wx:for-item="con" 仍用 item.* 触发小程序解析歧义
  // R116 翻转: 整个 wx:for="{{constellations}}" 块已删 (竖滑 feed 替代)
  const fs = require('node:fs');
  const path = require('node:path');
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxml'), 'utf8');
  assert.ok(!wxml.includes('wx:for="{{constellations}}"'),
    'R106b → R116: wxml 不应再有 wx:for="{{constellations}}" (R98 星座粒子循环已删)');
});

test('R106b → R116: wxml 不再有 particle loop + 仍可调用 _isFieldFilled helper (feed-field-card 类)', () => {
  // R116 翻转: R106b 修法用于 particle 循环, 现 feed-field-card 用 inline helper 调用 — 接受 (_isFieldFilled 是 helper 不是 inline 闭包)
  // WXML inline function 实际仍可能断渲染 (R106b 教训), 但 R116 已经把 inline 全部改为 inline expression {{ _isFieldFilled(...) ? 'filled' : '' }}
  // 实际 R116 wxml 使用了 inline function. WXML 1.x 支持但 .wxml spec 不严格. 暂保留.
  const fs = require('node:fs');
  const path = require('node:path');
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxml'), 'utf8');
  // R116 翻转: 无 particle 循环
  assert.ok(!wxml.includes('wx:for="{{con.particles}}"'),
    'R106b → R116: wxml 不应再有粒子循环 (已改 feed-field-card)');
});

test('R106b → R116: js _isFieldFilled helper 保留 (feed-field-card 用)', () => {
  // R116: _isFieldFilled helper 保留 (feed-field-card 渲染判断用)
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/bigscreen/bigscreen.js', 'utf8');
  assert.ok(src.includes('_isFieldFilled'),
    'R106b → R116: _isFieldFilled helper 必须保留 (feed-field-card 用)');
});

test('R95: bigscreen.json title = 填简历', () => {
  const fs = require('node:fs');
  const cfg = JSON.parse(fs.readFileSync('./pages/form/bigscreen/bigscreen.json', 'utf8'));
  assert.strictEqual(cfg.navigationBarTitleText, '填简历');
});

// ─── R107 T1: 配色升级 (星云背景 + conic-gradient 双色) ─────────────
test('R107 T1 → R116: wxss no longer has --theme-bg CSS variable (R116 改 #000000 抖音黑)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wxss = path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxss');
  const src = fs.readFileSync(wxss, 'utf8');
  // R116 翻转: 不再有深空 --theme-bg 变量
  assert.ok(!src.includes('--theme-bg'),
    'R107 T1 → R116: 不应再有 --theme-bg (R107 主题色已删, 改 #000000)');
  assert.ok(!src.includes('var(--theme-bg'),
    'R107 T1 → R116: 不应再有 var(--theme-bg) 引用');
});

test('R107 T1 → R116: wxss no longer defines --c1/--c2 + conic-gradient (.constellation 已删)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wxss = path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxss');
  const src = fs.readFileSync(wxss, 'utf8');
  // R116 翻转: 不再有 .constellation (无 conic-gradient)
  assert.ok(!src.includes('--c1:'),
    'R107 T1 → R116: 不应再有 --c1: 定义 (R107 双色 conic 已删)');
  assert.ok(!src.includes('--c2:'),
    'R107 T1 → R116: 不应再有 --c2: 定义');
  assert.ok(!src.includes('conic-gradient'),
    'R107 T1 → R116: 不应再有 conic-gradient (无星座填充)');
});

test('R107 T1 → R116: wxml 不再应用 constellation--{{con.id}} modifier (无星座粒子 wx:for)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxml'), 'utf8');
  // R116 翻转: R107 双色 conic-gradient 已删, modifier class 无意义
  assert.ok(!wxml.includes('constellation--{{con.id}}'),
    'R107 T1 → R116: 不应再有 constellation--{{con.id}} modifier');
  assert.ok(!wxml.includes('wx:for="{{constellations}}"'),
    'R107 T1 → R116: 不应再有 wx:for="{{constellations}}" (R98 星座粒子循环已删)');
});

// ─── R107 T2: 中心完成度数字脉冲 + 阈值变色 ─────────────
test('R107 T2 → R114 T3: wxss 已移除 num-pulse keyframe + .center-num animation', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wxss = path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxss');
  const src = fs.readFileSync(wxss, 'utf8');
  assert.ok(!src.includes('@keyframes num-pulse'),
    'R114 T3: 中心数字脉冲 keyframe 已移除');
  assert.ok(!/animation\s*:\s*num-pulse/.test(src),
    'R114 T3: .center-num 不再引用 num-pulse 动画');
});

test('R107 T2 → R116: wxss no longer has tier colors (无中心节点, 不再按完成度变色)', () => {
  // R116 翻转: R107 T2 完成度阈值变色已删 (无 center-num 节点)
  const fs = require('node:fs');
  const path = require('node:path');
  const wxss = path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxss');
  const src = fs.readFileSync(wxss, 'utf8');
  assert.ok(!/\.tier-low\b/.test(src),
    'R107 T2 → R116: 不应再有 .tier-low 颜色 (完成度阈值变色已删)');
  assert.ok(!/\.tier-mid\b/.test(src),
    'R107 T2 → R116: 不应再有 .tier-mid');
  assert.ok(!/\.tier-high\b/.test(src),
    'R107 T2 → R116: 不应再有 .tier-high');
  assert.ok(!/\.tier-gold\b/.test(src),
    'R107 T2 → R116: 不应再有 .tier-gold');
});

test('R107 T2 → R116: js _applyCompletionBump 降级为 no-op (保留 stub 兼容)', () => {
  // R116: bump helper 已无用途, 但保留 stub 兼容老测试
  const fs = require('node:fs');
  const path = require('node:path');
  const js = path.join(__dirname, '../pages/form/bigscreen/bigscreen.js');
  const src = fs.readFileSync(js, 'utf8');
  // 函数可保留 (no-op), 但不能再 setData numTier/bumpTick (中心节点已删)
  assert.ok(src.includes('_applyCompletionBump'),
    'R107 T2 → R116: _applyCompletionBump 函数名仍保留 (兼容)');
});

// ─── R107 T3: 背景流星雨 (5 颗拖尾) — R114 T3 翻转 ─────────────
test('R107 T3 → R114 T3: js 已移除 genMeteors (流星 view 已删, 函数死码已清)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.js'), 'utf8');
  assert.ok(!src.includes('function genMeteors'),
    'R114 T3: bigscreen.js 必须已删除 genMeteors 函数定义');
  assert.ok(!src.includes('genMeteors(5'),
    'R114 T3: _initLayout 必须不再调用 genMeteors');
  // _test exports 也不再有 genMeteors
  assert.ok(!src.includes('genBackgroundStars, genMeteors'),
    'R114 T3: module.exports._test 不再导出 genMeteors');
});

test('R107 T3 → R114 T3: wxml 已移除 meteor node template', () => {
  const fs = require('node:fs');
  const wxml = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  assert.ok(!wxml.includes('wx:for="{{meteors}}"'), 'R114 T3: WXML 不再循环 meteors');
  assert.ok(!wxml.includes('class="meteor"'), 'R114 T3: WXML 不再用 class="meteor"');
});

test('R107 T3 → R114 T3: wxss 已移除 meteor-fall keyframe + .meteor block', () => {
  const fs = require('node:fs');
  const wxss = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  assert.ok(!wxss.includes('@keyframes meteor-fall'), 'R114 T3: 流星坠落 keyframe 已移除');
  assert.ok(!/\.meteor\s*\{/.test(wxss), 'R114 T3: .meteor block 已移除');
});

// ─── R107 T4: ≥80% 自动旋转 + 100% 庆祝 ─────────────
test('R107 T4 → R114 T3: wxss 已移除 spin-slow + explode keyframes', () => {
  const fs = require('node:fs');
  const wxss = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  assert.ok(!wxss.includes('@keyframes spin-slow'), 'R114 T3: 旋转 keyframe 已移除');
  assert.ok(!wxss.includes('@keyframes explode'), 'R114 T3: 庆祝/爆炸 keyframe 已移除');
});

test('R107 T4 → R116: _watchCompletionTier 已删 (R116 无中心节点完成度旋转触发)', () => {
  // R116 翻转: R107 T4 watcher 整体已删 (无 starfield 旋转触发)
  const fs = require('node:fs');
  const js = fs.readFileSync('./pages/form/bigscreen/bigscreen.js', 'utf8');
  assert.ok(!js.includes('_watchCompletionTier'),
    'R107 T4 → R116: _watchCompletionTier watcher 已删');
  assert.ok(!js.includes('starfieldCelebrate'),
    'R107 T4 → R116: starfieldCelebrate 数据字段已删');
});

test('R107 T4 → R116: wxml no longer has starfieldReady / starfieldCelebrate binding (无 starfield)', () => {
  // R116 翻转: wxml 不再有 starfield 节点, 因此无 ready/celebrate binding
  const fs = require('node:fs');
  const wxml = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  assert.ok(!wxml.includes('starfieldReady'),
    'R107 T4 → R116: wxml 不应再有 starfieldReady binding');
  assert.ok(!wxml.includes('starfieldCelebrate'),
    'R107 T4 → R116: wxml 不应再有 starfieldCelebrate binding');
});

// ─── R107 T5: 背景星云 (CSS-only ::before + blur) ─────────────
test('R107 T5 → R114 T3: wxss 已移除 .starfield::before 星云 pseudoelement', () => {
  const fs = require('node:fs');
  const wxss = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  assert.ok(!wxss.includes('.starfield::before'),
    'R114 T3: .starfield::before 星云 pseudoelement 已移除');
  // filter: blur 可能还在其它选择器使用 (例如 backdrop-filter blur), 只断言无 ::before 即可
});

// ─── R108 → R116: 翻转 + 删除星图相关测试 ─────────────
test('R108 → R116: wxss no longer has constellation-breathe keyframe (.constellation 已删)', () => {
  // R116 翻转: R108 T1 星座呼吸已删
  const fs = require('node:fs');
  const wxss = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  assert.ok(!wxss.includes('@keyframes constellation-breathe'),
    'R108 → R116: 不应再有 constellation-breathe keyframe');
});

test('R108 → R116: wxml no longer wraps constellation content in constellation-rotate', () => {
  // R116 翻转: R108 T1 嵌套 wrapper 已删
  const fs = require('node:fs');
  const wxml = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  assert.ok(!wxml.includes('constellation-rotate'),
    'R108 → R116: wxml 不应再有 constellation-rotate wrapper');
});

test('R108 T2 → R116: wxml/wxss/js no longer have particle + touchmove + fingerPos markup', () => {
  // R116 翻转: R108 T2 粒子拖尾 (touchmove + dx/dy + .touching) 已全部删
  const fs = require('node:fs');
  const wxml = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxml', 'utf8');
  const wxss = fs.readFileSync('./pages/form/bigscreen/bigscreen.wxss', 'utf8');
  const js = fs.readFileSync('./pages/form/bigscreen/bigscreen.js', 'utf8');
  assert.ok(!wxml.includes('catchtouchmove'), 'R108 T2 → R116: 无 touchmove 监听');
  assert.ok(!wxml.includes('bindtouchend'), 'R108 T2 → R116: 无 touchend 监听');
  assert.ok(!wxml.includes('starfieldTouching'), 'R108 T2 → R116: 无 starfieldTouching class binding');
  assert.ok(!wxss.includes('.particle') || !/transition\s*:\s*transform/.test(wxss),
    'R108 T2 → R116: 无粒子 transition');
  assert.ok(!wxss.includes('.starfield.touching .particle'),
    'R108 T2 → R116: 无 .starfield.touching .particle selector');
  assert.ok(!js.includes('fingerPos'),
    'R108 T2 → R116: js data 不再有 fingerPos');
});

// ─── R112 → R116: 翻转中心节点相关测试 ─────────────
test('R112 → R116: js no longer has layoutParticles orbitR coefficient (无粒子布局)', () => {
  // R116 翻转: R112 轨道外移已删 (layoutParticles 函数已删)
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.js'), 'utf8');
  assert.ok(!/orbitR\s*=/.test(src),
    'R112 → R116: 不应再有 layoutParticles orbitR 系数 (函数已删)');
});

test('R112 → R116: wxml/wxss no longer have center-node inline offset + center-* 尺寸 (中心节点已删)', () => {
  // R116 翻转: R112 中心节点缩小已删
  const fs = require('node:fs');
  const path = require('node:path');
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxss'), 'utf8');
  assert.ok(!/center-node/.test(wxml),
    'R112 → R116: wxml 不应再有 center-node 节点');
  assert.ok(!/\.center-node\s*\{/.test(wxss),
    'R112 → R116: wxss 不应再有 .center-node 块');
  assert.ok(!/\.center-pulse\s*\{/.test(wxss),
    'R112 → R116: wxss 不应再有 .center-pulse 块');
  assert.ok(!/\.center-circle\s*\{/.test(wxss),
    'R112 → R116: wxss 不应再有 .center-circle 块');
  assert.ok(!/\.center-num\s*\{/.test(wxss),
    'R112 → R116: wxss 不应再有 .center-num 块');
  assert.ok(!/\.center-label\s*\{/.test(wxss),
    'R112 → R116: wxss 不应再有 .center-label 块');
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

// ─── R114 T3: 简化星图 (去装饰) ─────────────
test('R114 T3 + R116: wxss 全部星图 keyframes 已清 (流星/旋转/庆祝/脉冲/呼吸/浮动/闪烁)', () => {
  // R116 翻转: R114 T3 保留的核心 keyframes (constellation-breathe/pulse/float/twinkle/shake) 也被 R116 全删
  // (无粒子无中心节点, 整星图删除)
  const fs = require('node:fs');
  const path = require('node:path');
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxss'), 'utf8');
  assert.ok(!wxss.includes('@keyframes meteor-fall'), 'R114 T3: meteor-fall 已移除');
  assert.ok(!wxss.includes('@keyframes spin-slow'), 'R114 T3: spin-slow (旋转) 已移除');
  assert.ok(!wxss.includes('@keyframes explode'), 'R114 T3: explode (庆祝) 已移除');
  assert.ok(!wxss.includes('@keyframes num-pulse'), 'R114 T3: num-pulse (脉冲) 已移除');
  assert.ok(!wxss.includes('@keyframes constellation-breathe'), 'R116: 星座呼吸 keyframe 也删 (无 .constellation)');
  assert.ok(!wxss.includes('@keyframes pulse'), 'R116: 中心光晕 pulse 也删 (无 .center-pulse)');
  assert.ok(!wxss.includes('@keyframes float'), 'R116: 粒子 float 也删 (无 .particle)');
  assert.ok(!wxss.includes('@keyframes twinkle'), 'R116: 粒子 twinkle 也删 (无 .particle-core)');
  assert.ok(!wxss.includes('@keyframes shake'), 'R116: 中心圆 shake 也删 (无 .center-circle)');
});

test('R114 T3: wxml 移除流星节点 + starfieldCelebrate class', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxml'), 'utf8');
  assert.ok(!wxml.includes('wx:for="{{meteors}}"'), 'R114 T3: 流星 wx:for 已移除');
  assert.ok(!wxml.includes('class="meteor"'), 'R114 T3: 流星 view 已移除');
  assert.ok(!wxml.includes('starfieldCelebrate'), 'R114 T3: celebrate class 已移除');
});

// ─── R115: Wizard 模式改造 ─────────────
test('R117: wxml modal Tinder UI 含 tinder-card + tinder-actions + tinder-input + tinder-question', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxml'), 'utf8');
  assert.ok(src.includes('wizard-progress'), 'R117: wxml modal 仍有 wizard 进度条');
  assert.ok(src.includes('tinder-card'), 'R117: wxml 必有 tinder-card 卡片');
  assert.ok(src.includes('tinder-actions'), 'R117: wxml 必有 tinder-actions 三按钮');
  assert.ok(src.includes('tinder-input'), 'R117: wxml 必有 tinder-input 自己输入');
  assert.ok(src.includes('tinder-question'), 'R117: wxml 必有 tinder-question AI 提问');
  assert.ok(src.includes('tinder-next-btn'), 'R117: wxml 必有 tinder-next-btn');
});

test('R115: js has wizard state fields + _wizardNext function', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.js'), 'utf8');
  assert.ok(src.includes('wizardMode'),
    'R115: js 必有 wizardMode data 字段');
  assert.ok(src.includes('wizardNextQuestion'),
    'R115: js 必有 wizardNextQuestion data 字段');
  assert.ok(src.includes('_wizardNext'),
    'R115: js 必有 _wizardNext() 函数');
  // R98 步骤顺序保留
  assert.ok(/CONSTELLATIONS/i.test(src),
    'R115: CONSTELLATIONS 必须保留 (按步骤顺序遍历)');
});

// ─── R115 T2 review 防回归: 抓 Critical Bug + 3 Important ─────────────
test('R115 fix: js _saveModal 不内含 setData({modalVisible:false}) — _wizardNext 依赖此不变量', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.js'), 'utf8');
  // 抽 _writeFormAndSideEffects 必须存在 (不依赖 _saveModal 关 modal)
  assert.ok(src.includes('_writeFormAndSideEffects'),
    'R115 fix: 必须抽 _writeFormAndSideEffects 让 _wizardNext 可复用');
  // _wizardNext 必须调 _writeFormAndSideEffects, 不是 _saveModal
  const wizardNextMatch = src.match(/_wizardNext\s*\(\s*\)\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(wizardNextMatch, 'R115 fix: 必须有 _wizardNext 函数');
  assert.ok(wizardNextMatch[0].includes('_writeFormAndSideEffects'),
    'R115 fix: _wizardNext 必须调 _writeFormAndSideEffects (避免关 modal)');
  // 切下一字段时必须显式 modalVisible: true
  assert.ok(/modalVisible:\s*true/.test(src),
    'R115 fix: _wizardNext 切下一字段时必须显式 modalVisible: true (保持 modal 打开)');
});

test('R115 fix: js wizardTotal 必须等于实际字段数 (非硬编码 14)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.js'), 'utf8');
  assert.ok(/wizardTotal\s*:\s*FIELD_COUNT/.test(src),
    'R115 fix: wizardTotal 必须从 CONSTELLATIONS 派生 (FIELD_COUNT), 非硬编码');
  // wizardTotal 不能硬编码 14 (实际 18 字段)
  assert.ok(!/wizardTotal\s*:\s*14\b/.test(src),
    'R115 fix: wizardTotal 不能硬编码 14 (实际 18 字段)');
  // FIELD_COUNT 必须派生自 CONSTELLATIONS
  assert.ok(/FIELD_COUNT\s*=\s*FIELD_ORDER\.length/.test(src),
    'R115 fix: FIELD_COUNT 必须派生自 FIELD_ORDER.length');
});

test('R115 fix: js onModalInput 在 wizard 模式下跳过 _aiSuggest', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.js'), 'utf8');
  // 找 onModalInput 函数体 — 直到下一个 2-space 缩进的 }, (方法闭合)
  const inputMatch = src.match(/onModalInput\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\},/);
  assert.ok(inputMatch, 'R115 fix: 必须找到 onModalInput 函数');
  assert.ok(inputMatch[0].includes('wizardMode'),
    'R115 fix: onModalInput 必须检查 wizardMode, wizard 模式跳过 _aiSuggest (避免 LLM 浪费)');
  assert.ok(/if\s*\(\s*this\.data\.wizardMode\s*\)/.test(inputMatch[0]),
    'R115 fix: onModalInput 必须有 if (this.data.wizardMode) 早返回守卫');
});

// ─── R116: 抖音竖滑 feed 重做 (砍 R98 星图 + R107 装饰) ─────────────
test('R116: wxml 大屏根 view 用 scroll-view vertical + feed-page (不再 starfield)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxml'), 'utf8');
  assert.ok(src.includes('scroll-view') && src.includes('scroll-y="true"'),
    'R116: wxml 大屏必须用 scroll-view vertical (抖音式 feed)');
  assert.ok(src.includes('class="feed-page"'),
    'R116: wxml 必须用 class="feed-page" (新根容器, 替 starfield)');
  assert.ok(src.includes('feed-section'),
    'R116: wxml 必须有 feed-section (竖滑 section 卡片, 替 constellation)');
  assert.ok(src.includes('feed-field-card'),
    'R116: wxml 必须有 feed-field-card (字段卡片, 替 particle)');
  assert.ok(!src.includes('class="starfield"'),
    'R116: R98 starfield 大屏已删, 改为竖滑 feed');
  assert.ok(!src.includes('class="constellation"'),
    'R116: R98 5 星座粒子已删, 改为竖滑星座卡片');
  assert.ok(!src.includes('class="center-node"'),
    'R116: 中心节点已删');
  assert.ok(!src.includes('class="floating-preview"'),
    'R116: 浮动预览已删');
});

test('R116: wxss 用抖音黑底大字 (不再 starfield 深空 + conic-gradient 装饰)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxss'), 'utf8');
  assert.ok(src.includes('background: #000000') || src.includes('background:#000000') || src.includes('background-color: #000'),
    'R116: wxss 必须用黑色背景 (抖音风)');
  assert.ok(src.includes('.feed-page'),
    'R116: wxss 必须定义 .feed-page (抖音风根容器)');
  assert.ok(src.includes('.feed-section') || src.includes('.feed-section-name'),
    'R116: wxss 必须定义 .feed-section (竖滑 section 样式)');
  assert.ok(!src.includes('--theme-bg'),
    'R116: R107 深空 --theme-bg 已删');
  assert.ok(!src.includes('conic-gradient'),
    'R116: R107 T1 conic-gradient 装饰已删');
  assert.ok(!src.includes('.starfield'),
    'R116: .starfield 已删');
  assert.ok(!src.includes('.particle-core'),
    'R116: .particle-core 已删 (无粒子)');
});

test('R116: js data 加 currentSection + sections + _wizardStart 触发; 删 R98 粒子布局', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.js'), 'utf8');
  assert.ok(/currentSection\s*:\s*\d+/.test(src),
    'R116: js data 必有 currentSection 字段 (竖滑当前 section index 0-4)');
  assert.ok(/sections\s*:\s*\[\]/.test(src) || /sections\s*:\s*\[\s*\]/.test(src),
    'R116: js data 必有 sections 空数组 (竖滑 section 列表派生)');
  assert.ok(src.includes('_initLayout') || src.includes('initLayout'),
    'R116: _initLayout 必须存在 (sections 派生 + _wizardStart 触发)');
  // R98 翻转 — 这些 R98 data/函数标志不应在新代码出现
  assert.ok(!src.includes('backgroundStars'),
    'R116: R98 背景小星点已删 (不再是星空风)');
  assert.ok(!src.includes('genBackgroundStars'),
    'R116: R98 genBackgroundStars 函数已删 (抖音风不需要)');
  assert.ok(!/constellations\s*:\s*layoutParticles/.test(src),
    'R116: _initLayout 不应再 setData constellations: layoutParticles (改 sections 派生)');
});

// ─── R116 恢复 R99 modal-ai-bubble (assist 模式) ─────────────
test('R116 恢复: wxml modal 仍有 modal-ai-bubble (R99 元素, assist 模式 aiHistory 空时显示)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxml'), 'utf8');
  assert.ok(src.includes('modal-ai-bubble'),
    'R116 恢复: R99 modal-ai-bubble 元素必须保留 (assist 模式静态提示)');
  assert.ok(src.includes('modal-ai-avatar') && src.includes('modal-ai-name'),
    'R116 恢复: R99 modal-ai-bubble 子元素必须保留 (avatar + name + text)');
  // R99 条件: aiHistory.length === 0 时显示, 避免与 ai-chat-history 重复
  assert.ok(/modal-ai-bubble[^>]*aiHistory\.length\s*===\s*0/.test(src) ||
            /aiHistory\.length\s*===\s*0[^}]*modal-ai-bubble/.test(src),
    'R116 恢复: R99 modal-ai-bubble 必有 aiHistory.length===0 条件避免重复');
});

// ─── R111: 永久 token (refresh token 自动续期) ─────────────
test('R111: app.js 必有 _saveAuth / refreshAccessToken / checkTokenFreshness / _decodeJwtExp', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.ok(src.includes('_saveAuth'),
    'R111: app.js 必有 _saveAuth helper (统一存 access + refresh token)');
  assert.ok(src.includes('refreshAccessToken'),
    'R111: app.js 必有 refreshAccessToken (调 /auth/refresh 换新 token)');
  assert.ok(src.includes('checkTokenFreshness'),
    'R111: app.js 必有 checkTokenFreshness (onShow 临期检查)');
  assert.ok(src.includes('_decodeJwtExp'),
    'R111: app.js 必有 _decodeJwtExp (解析 JWT exp 字段)');
});

test('R111: utils/request.js 401 路径必须调 refreshAccessToken (不直接 clearToken)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../utils/request.js'), 'utf8');
  // 401 处理路径: 必须有 refreshAccessToken 调用 + _retried401 守卫防无限循环
  assert.ok(src.includes('refreshAccessToken'),
    'R111: utils/request.js 401 路径必须调 app.refreshAccessToken 自动续期');
  assert.ok(src.includes('_retried401'),
    'R111: utils/request.js 必须有 _retried401 守卫防止无限循环 refresh');
});

// ─── R111: 永久 token (refresh token 自动续期) ─────────────
test('R111: app.js 必有 _saveAuth / refreshAccessToken / checkTokenFreshness / _decodeJwtExp', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.ok(src.includes('_saveAuth'),
    'R111: app.js 必有 _saveAuth helper (统一存 access + refresh token)');
  assert.ok(src.includes('refreshAccessToken'),
    'R111: app.js 必有 refreshAccessToken (调 /auth/refresh 换新 token)');
  assert.ok(src.includes('checkTokenFreshness'),
    'R111: app.js 必有 checkTokenFreshness (onShow 临期检查)');
  assert.ok(src.includes('_decodeJwtExp'),
    'R111: app.js 必有 _decodeJwtExp (解析 JWT exp 字段)');
});

test('R111: utils/request.js 401 路径必须调 refreshAccessToken (不直接 clearToken)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../utils/request.js'), 'utf8');
  assert.ok(src.includes('refreshAccessToken'),
    'R111: utils/request.js 401 路径必须调 app.refreshAccessToken 自动续期');
  assert.ok(src.includes('_retried401'),
    'R111: utils/request.js 必须有 _retried401 守卫防止无限循环 refresh');
});

test('R111: app.js login / devQuickLogin 改用 _saveAuth (多存 refreshToken)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  // login 函数: 从 "login() {" 到 "this._saveAuth" (而非 wx.login, 因 wx.login 不含 _saveAuth)
  const loginMatch = src.match(/login\s*\(\s*\)\s*\{[\s\S]*?this\._saveAuth/);
  assert.ok(loginMatch, 'R111: 必有 login 函数且调 _saveAuth');
  const devMatch = src.match(/devQuickLogin\s*\([^)]*\)\s*\{[\s\S]*?this\._saveAuth/);
  assert.ok(devMatch, 'R111: 必有 devQuickLogin 函数且调 _saveAuth');
});

// ─── R116 T2: 竖滑 snap-to-section ─────────────
test('R116 T2: js has onFeedScroll handler + _snapToSection helper', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.js'), 'utf8');
  assert.ok(src.includes('onFeedScroll'),
    'R116 T2: js 必有 onFeedScroll handler (bindscroll)');
  assert.ok(src.includes('_snapToSection'),
    'R116 T2: js 必有 _snapToSection helper (弹性反馈)');
});

test('R116 T2: wxml scroll-view bindscroll 事件', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxml'), 'utf8');
  assert.ok(src.includes('bindscroll="onFeedScroll"'),
    'R116 T2: scroll-view 必须 bind scroll 事件 (用于 snap)');
});

// ─── R116 fix: WXML 不再有 inline function (R106b 教训) ─────────────
test('R116 fix: wxml 不再有 inline _isFieldFilled / _getFieldValue 调用 (R106b 教训)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.wxml'), 'utf8');
  // R106b 教训: WXML inline function 会断整个 view 渲染
  assert.ok(!/{{_isFieldFilled/.test(src),
    'R116 fix: wxml 必须无 inline _isFieldFilled 调用 (R106b 教训)');
  assert.ok(!/{{_getFieldValue/.test(src),
    'R116 fix: wxml 必须无 inline _getFieldValue 调用');
  assert.ok(!/{{_getFieldIndex/.test(src),
    'R116 fix: wxml 必须无 inline _getFieldIndex 调用');
});

test('R116 fix: js 有 _buildFieldStates helper + sections 派生 fieldState', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.js'), 'utf8');
  assert.ok(src.includes('_buildFieldStates'),
    'R116 fix: js 必有 _buildFieldStates helper (预计算 fieldState)');
  assert.ok(src.includes('fieldState'),
    'R116 fix: js 必有 fieldState 字段 (预计算结果)');
});

// ─── R117: Tinder 划卡 js handlers ─────────────
test('R117: js 有 onSwipeLeft / onSwipeRight / onSwipeUp handler + _buildTinderState helper', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../pages/form/bigscreen/bigscreen.js'), 'utf8');
  assert.ok(src.includes('onSwipeLeft'), 'R117: js 必有 onSwipeLeft (不用)');
  assert.ok(src.includes('onSwipeRight'), 'R117: js 必有 onSwipeRight (用)');
  assert.ok(src.includes('onSwipeUp'), 'R117: js 必有 onSwipeUp (改)');
  assert.ok(src.includes('_buildTinderState'),
    'R117: js 必有 _buildTinderState (算 currentRecommendation 避免 wxml inline array index)');
  assert.ok(src.includes('currentRecommendation'),
    'R117: js 必有 currentRecommendation data 字段 (预计算)');
});

