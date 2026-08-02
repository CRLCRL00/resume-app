/**
 * R-JobPilot-v2 W3: 对话建简历页面 smoke 测试
 *
 * 覆盖 (结构 + 配置验证):
 *   - 4 个文件存在 (wxml/wxss/js/json)
 *   - index.json 是合法 JSON, 含 navigationBarTitleText
 *   - wxml 含关键 UI 字符串 (AI 面试官 / 启动态 / 完成态 / 进度条)
 *   - wxss 含关键 class (chat-page / progress-bar / image-badge)
 *   - js 含关键 handler (onStart / onSubmit / goChatBuild / _complete)
 *   - js 含 4 种画像选项 (ai_collaboration_project_lead / traditional_cs_fresh / career_transition / algorithm_research)
 *   - app.json 注册 chat-build 路径
 *   - jobpilot/index.wxml 含 chat-build 入口
 *
 * 注: Page 组件行为测试需要 wx mock (jsdom + wx global mock), 超出 W3 范围
 *      Week 4 + 真机验证覆盖
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CHAT_BUILD_DIR = path.join(__dirname, '..', 'pages', 'jobpilot', 'chat-build');
const APP_JSON_PATH = path.join(__dirname, '..', 'app.json');
const JOBPILOT_INDEX_DIR = path.join(__dirname, '..', 'pages', 'jobpilot', 'index');

// ============== 文件存在性 ==============

test('chat-build 目录 4 个文件存在', () => {
  for (const f of ['index.wxml', 'index.wxss', 'index.js', 'index.json']) {
    const p = path.join(CHAT_BUILD_DIR, f);
    assert.ok(fs.existsSync(p), `${f} should exist`);
    const stat = fs.statSync(p);
    assert.ok(stat.size > 50, `${f} should not be empty (${stat.size} bytes)`);
  }
});

// ============== index.json 合法性 ==============

test('index.json 是合法 JSON + 含 navigationBarTitleText', () => {
  const raw = fs.readFileSync(path.join(CHAT_BUILD_DIR, 'index.json'), 'utf8');
  const cfg = JSON.parse(raw);
  assert.ok(cfg.navigationBarTitleText, 'navigationBarTitleText 应存在');
  assert.equal(cfg.navigationBarTitleText, 'AI 对话建简历');
});

// ============== wxml 关键 UI ==============

test('index.wxml 含关键 UI 字符串', () => {
  const wxml = fs.readFileSync(path.join(CHAT_BUILD_DIR, 'index.wxml'), 'utf8');
  assert.ok(wxml.includes('AI 面试官'), '应有 AI 面试官 label');
  assert.ok(wxml.includes('chat-history'), '应有对话历史 scroll-view');
  assert.ok(wxml.includes('progress-bar'), '应有进度条');
  assert.ok(wxml.includes('image-picker'), '应有启动态画像选择器');
  assert.ok(wxml.includes('completed-banner'), '应有完成态 banner');
  assert.ok(wxml.includes('story-points'), '应有 STAR 故事点展示');
});

// ============== wxss 关键 class ==============

test('index.wxss 含关键 class', () => {
  const wxss = fs.readFileSync(path.join(CHAT_BUILD_DIR, 'index.wxss'), 'utf8');
  for (const cls of ['.chat-page', '.progress-bar', '.image-badge', '.assistant-bubble', '.user-bubble', '.btn-primary', '#6366f1']) {
    assert.ok(wxss.includes(cls), `${cls} 应存在`);
  }
});

// ============== js 关键 handler ==============

test('index.js 含关键 handler', () => {
  const js = fs.readFileSync(path.join(CHAT_BUILD_DIR, 'index.js'), 'utf8');
  for (const handler of ['onLoad', 'onPickImage', 'onStart', 'onInputChange', 'onSubmit', '_complete', 'goBack', '_mkMsg', '_errMsg']) {
    assert.ok(js.includes(handler + '(') || js.includes(handler + ' '), `${handler} 应存在`);
  }
});

test('index.js 含 4 种画像选项', () => {
  const js = fs.readFileSync(path.join(CHAT_BUILD_DIR, 'index.js'), 'utf8');
  for (const image of ['ai_collaboration_project_lead', 'traditional_cs_fresh', 'career_transition', 'algorithm_research']) {
    assert.ok(js.includes(image), `${image} 画像应存在`);
  }
});

test('index.js 调用 3 个 API endpoint', () => {
  const js = fs.readFileSync(path.join(CHAT_BUILD_DIR, 'index.js'), 'utf8');
  assert.ok(js.includes('/api/jobpilot/v1/chat-build/start'), '应调 start API');
  assert.ok(js.includes('/api/jobpilot/v1/chat-build/next'), '应调 next API');
  assert.ok(js.includes('/api/jobpilot/v1/chat-build/complete'), '应调 complete API');
});

// ============== app.json 注册 ==============

test('app.json 含 chat-build 路径', () => {
  const raw = fs.readFileSync(APP_JSON_PATH, 'utf8');
  const cfg = JSON.parse(raw);
  assert.ok(cfg.pages.includes('pages/jobpilot/chat-build/index'), 'app.json.pages 应含 chat-build');
});

// ============== jobpilot/index 入口 ==============

test('jobpilot/index.wxml 含 chat-build 入口 banner', () => {
  const wxml = fs.readFileSync(path.join(JOBPILOT_INDEX_DIR, 'index.wxml'), 'utf8');
  assert.ok(wxml.includes('chat-build-entry'), '应有 chat-build-entry banner');
  assert.ok(wxml.includes('AI 对话建简历'), '应有 AI 对话建简历 title');
  assert.ok(wxml.includes('goChatBuild'), '应有 bindtap goChatBuild');
});

test('jobpilot/index.js 含 goChatBuild handler', () => {
  const js = fs.readFileSync(path.join(JOBPILOT_INDEX_DIR, 'index.js'), 'utf8');
  assert.ok(js.includes('goChatBuild'), '应有 goChatBuild handler');
  assert.ok(js.includes('pages/jobpilot/chat-build/index'), '应 navigateTo chat-build');
});

test('jobpilot/index.wxss 含 chat-build-entry 样式', () => {
  const wxss = fs.readFileSync(path.join(JOBPILOT_INDEX_DIR, 'index.wxss'), 'utf8');
  assert.ok(wxss.includes('.chat-build-entry'), '应有 .chat-build-entry 样式');
  assert.ok(wxss.includes('linear-gradient') && wxss.includes('#6366f1') && wxss.includes('#8b5cf6'), '应有紫色渐变');
});