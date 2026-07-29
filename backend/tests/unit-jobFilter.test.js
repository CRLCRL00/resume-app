/**
 * jobFilter 单元测试 (无 DB 依赖)
 *
 * 测试函数:
 *   - userYears(form) — 计算用户工作年限
 *   - parseExpReq(s) — 解析经验要求字符串
 *   - coarseFilter(jobs, form, limit) — 粗筛 (城市 + 薪资 + 经验)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { userYears, parseExpReq, coarseFilter } = require('../src/services/jobFilter');

// 通用 helper: 5 年经验用户 (2021-07 至今)
const fiveYearsExp = [{ start: '2021-07', end: '至今' }];
// 8 年经验用户
const eightYearsExp = [{ start: '2018-06', end: '至今' }];
// 2 年经验用户
const twoYearsExp = [{ start: '2024-01', end: '至今' }];
// 1 年经验用户
const oneYearExp = [{ start: '2025-06', end: '至今' }];

// ==================== userYears ====================

test('userYears: 空 experiences 返 0', () => {
  assert.equal(userYears({ experiences: [] }), 0);
  assert.equal(userYears({}), 0);
  assert.equal(userYears({ experiences: null }), 0);
});

test('userYears: 单段经历 (起 2020-01 至今)', () => {
  const now = new Date();
  const thisYear = now.getFullYear();
  const expected = thisYear - 2020 + (now.getMonth() + 1 - 1) / 12;
  const result = userYears({
    experiences: [{ start: '2020-01', end: '至今' }],
  });
  assert.ok(Math.abs(result - Math.round(expected * 10) / 10) <= 0.2);
});

test('userYears: 多段经历,取最早到最新', () => {
  const result = userYears({
    experiences: [
      { start: '2018-06', end: '2020-08' },
      { start: '2021-03', end: '至今' },
    ],
  });
  assert.ok(result >= 7 && result <= 9, `expected 7-9, got ${result}`);
});

test('userYears: 完整时间 (2020-01 ~ 2024-01 = 4 年)', () => {
  assert.equal(userYears({ experiences: [{ start: '2020-01', end: '2024-01' }] }), 4);
});

test('userYears: 缺 start 也能算 (用 end - 默认起始)', () => {
  const result = userYears({ experiences: [{ start: null, end: '2024-06' }] });
  assert.ok(result >= 0);
});

test('userYears: 反向时间 (end < start) 返 0', () => {
  assert.equal(userYears({ experiences: [{ start: '2024-01', end: '2020-01' }] }), 0);
});

// ==================== parseExpReq ====================

test('parseExpReq: "不限" 返 null (no filter)', () => {
  assert.equal(parseExpReq('不限'), null);
  assert.equal(parseExpReq('经验不限'), null);
  assert.equal(parseExpReq(''), null);
  assert.equal(parseExpReq(null), null);
});

test('parseExpReq: "1-3年" 返 {min:1, max:3}', () => {
  assert.deepEqual(parseExpReq('1-3年'), { min: 1, max: 3 });
  assert.deepEqual(parseExpReq('1-3 年'), { min: 1, max: 3 });
  assert.deepEqual(parseExpReq('1~3年'), { min: 1, max: 3 });
});

test('parseExpReq: "5年以上" 返 {min:5, max:Infinity}', () => {
  assert.deepEqual(parseExpReq('5年以上'), { min: 5, max: Infinity });
});

test('parseExpReq: "3年以下" 返 {min:0, max:2}', () => {
  assert.deepEqual(parseExpReq('3年以下'), { min: 0, max: 2 });
});

test('parseExpReq: 乱码返 null (no filter)', () => {
  assert.equal(parseExpReq('abc'), null);
  assert.equal(parseExpReq('经验'), null);
});

// ==================== coarseFilter ====================

const sampleJobs = [
  { id: 1, title: '北京 PHP', city: '北京', salary_min: 10, salary_max: 20, experience_required: '3-5年' },
  { id: 2, title: '深圳 PHP', city: '深圳', salary_min: 10, salary_max: 20, experience_required: '3-5年' },
  { id: 3, title: '深圳 Go', city: '深圳', salary_min: 25, salary_max: 50, experience_required: '5年以上' },
  { id: 4, title: '深圳 Python', city: '深圳', salary_min: 15, salary_max: 30, experience_required: '不限' },
  { id: 5, title: '广州 Java', city: '广州', salary_min: 8, salary_max: 15, experience_required: '1-3年' },
];

test('coarseFilter: 5 年经验 + 深圳 + 10-20K → 3 个候选 (job2/3/4)', () => {
  // sampleJobs: job1 北京, job2 深圳 3-5年, job3 深圳 5年以上, job4 深圳 不限, job5 广州
  // 城市深圳:job1(北京)/job5(广州) 过滤 → 剩 job2/3/4
  const filtered = coarseFilter(sampleJobs, {
    expected: { city: '深圳', salary_min: 10, salary_max: 20 },
    experiences: fiveYearsExp,
  }, 10);
  // 5 年经验:job2 (3-5) 通过,job3 (5年以上) 通过,job4 (不限) 通过
  // 薪资 10-20:job2 (10-20) ✓,job3 (25-50) ✓ (10-20*1.5=30,25<30),job4 (15-30) ✓
  assert.equal(filtered.length, 3);
});

test('coarseFilter: 8 年经验 + 深圳 + 30-100K → 2 个 (资深过滤 3-5 年岗)', () => {
  const filtered = coarseFilter(sampleJobs, {
    expected: { city: '深圳', salary_min: 30, salary_max: 100 },
    experiences: eightYearsExp,
  }, 10);
  // 8 年对 job2 (3-5 年) 太资深: 8 > 5 true → 过滤
  // job3 (25-50): 经验 5年以上,8 ≥ 5 ✓; 薪资 salary_min 25 <= 100*1.5=150 ✓, salary_max 50 >= 30*0.8=24 ✓ → 通过
  // job4 (15-30): 经验不限 → 通过;薪资 salary_min 15 <= 150 ✓, salary_max 30 >= 24 ✓ → 通过
  assert.equal(filtered.length, 2);
  const ids = filtered.map(j => j.id).sort();
  assert.deepEqual(ids, [3, 4]);
});

test('coarseFilter: 5 年经验 + 深圳 + 15-25K → 3 个候选', () => {
  const filtered = coarseFilter(sampleJobs, {
    expected: { city: '深圳', salary_min: 15, salary_max: 25 },
    experiences: fiveYearsExp,
  }, 10);
  // 深圳:job2/3/4
  // 经验 5 年:全过
  // 薪资 15-25:都过
  assert.equal(filtered.length, 3);
});

test('coarseFilter: 2 年经验 + 深圳 → job3 (5年以上) 被过滤', () => {
  const filtered = coarseFilter(sampleJobs, {
    expected: { city: '深圳', salary_min: 0, salary_max: 100 },
    experiences: twoYearsExp,  // ~2 年
  }, 10);
  // 2 年对 job3 (5年以上): 2+1=3 < 5 true → 过滤
  // job2 (3-5 年): 2+1=3 < 3 false → 通过 (刚好)
  // job4 不限 → 通过
  assert.ok(!filtered.find(j => j.id === 3));
  assert.ok(filtered.find(j => j.id === 2));
});

test('coarseFilter: 1 年经验 → job2 (3-5年) 被过滤', () => {
  const filteredShort = coarseFilter(sampleJobs, {
    expected: { city: '深圳', salary_min: 0, salary_max: 100 },
    experiences: oneYearExp,  // ~1 年
  }, 10);
  // 1 年对 job2 (3-5 年): 1+1=2 < 3 true → 过滤
  assert.ok(!filteredShort.find(j => j.id === 2));
});

test('coarseFilter: 经验不限岗 (job4) 在任何经验下都通过', () => {
  const filtered = coarseFilter(sampleJobs, {
    expected: { city: '深圳', salary_min: 0, salary_max: 100 },
    experiences: oneYearExp,
  }, 10);
  assert.ok(filtered.find(j => j.id === 4));
});

test('coarseFilter: limit=2 限制返回数量', () => {
  const filtered = coarseFilter(sampleJobs, {
    expected: { city: '深圳', salary_min: 0, salary_max: 100 },
    experiences: fiveYearsExp,
  }, 2);
  assert.equal(filtered.length, 2);
});

test('coarseFilter: 无 limit 返全部 (深圳 3 个)', () => {
  const filtered = coarseFilter(sampleJobs, {
    expected: { city: '深圳', salary_min: 0, salary_max: 100 },
    experiences: fiveYearsExp,
  });
  assert.equal(filtered.length, 3);
});

test('coarseFilter: 用户未填城市 → 不过滤城市', () => {
  const filtered = coarseFilter(sampleJobs, {
    expected: { city: '', salary_min: 0, salary_max: 100 },
    experiences: fiveYearsExp,
  }, 10);
  // 5 个候选里:
  //   job1 (北京, 3-5年): 5 ≤ 5 → pass
  //   job2 (深圳, 3-5年): pass
  //   job3 (深圳, 5年以上): pass
  //   job4 (深圳, 不限): pass
  //   job5 (广州, 1-3年): 5 > 3 太资深 → 过滤
  // 预期 4 个
  assert.equal(filtered.length, 4);
});

test('coarseFilter: 用户未填薪资 → 不过滤薪资', () => {
  const filtered = coarseFilter(sampleJobs, {
    expected: { city: '深圳', salary_min: 0, salary_max: 0 },
    experiences: fiveYearsExp,
  }, 10);
  // 深圳 3 个候选都过
  assert.equal(filtered.length, 3);
});

// ==================== 集成 ====================

test('综合: 8 年经验用户 → coarseFilter → 候选 (job3 + job4)', () => {
  const userForm = {
    expected: { city: '深圳', salary_min: 15, salary_max: 25 },
    experiences: [{ start: '2018-06', end: '至今' }],  // ~8 年
  };
  const filtered = coarseFilter(sampleJobs, userForm, 10);
  // 城市深圳 → job2/3/4
  // 经验 8 年:job2 (3-5) 太资深 → 过滤
  //           job3 (5年以上) 8 ≥ 5 → 通过
  //           job4 不限 → 通过
  // 薪资 15-25:job3/4 都过
  // 预期 2 个:job3 + job4
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every(j => j.city === '深圳'));
  const ids = filtered.map(j => j.id).sort();
  assert.deepEqual(ids, [3, 4]);
});