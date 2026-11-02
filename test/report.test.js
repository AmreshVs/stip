const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, skipPattern, tip, commitInsight, hourLabel, sitLabel } = require('../src/main/report');
const { parseLine } = require('../src/main/git-history');
const { DEFAULTS, merge } = require('../src/main/store');

const EMPTY = { breaks: 0, skipped: 0, snoozed: 0, glasses: 0, hours: {}, skippedHours: {}, longestSitMin: 0 };
const NOW = new Date(2026, 10, 2, 12);

function week(patches = {}) {
  return Array.from({ length: 7 }, (_, i) => ({ ...EMPTY, date: `2026-10-${String(27 + i).padStart(2, '0')}`, ...patches[i] }));
}

function report(patches, extra = {}) {
  return buildReport({ week: week(patches), lastWeek: week(), streak: 0, settings: DEFAULTS, now: NOW, ...extra });
}

test('labels', () => {
  assert.equal(hourLabel(15), '3 pm');
  assert.equal(hourLabel(0), '12 am');
  assert.equal(sitLabel(45), '45 min');
  assert.equal(sitLabel(120), '2 h');
  assert.equal(sitLabel(160), '2 h 40 min');
});

test('an empty week is a draft, not a telling-off', () => {
  const r = report({});
  assert.equal(r.verdict, 'draft');
  assert.deepEqual(r.added, []);
  assert.equal(r.suggestion, null);
});

test('a good week is approved', () => {
  const r = report({ 0: { breaks: 8, glasses: 8 }, 1: { breaks: 8, glasses: 8 }, 2: { glasses: 8 }, 3: { glasses: 8 } }, { streak: 3 });
  assert.equal(r.verdict, 'approved');
  assert.deepEqual(r.added, ['16 breaks taken', 'Water goal met on 4 of 7 days', '3-day stand streak']);
  assert.deepEqual(r.removed, []);
  assert.equal(r.suggestion, null);
});

test('a long sit blocks approval and names the day', () => {
  const r = report({ 0: { breaks: 8, longestSitMin: 160 } });
  assert.equal(r.verdict, 'changes');
  assert.ok(r.removed.includes('Sat for 2 h 40 min straight on Tuesday'));
  assert.match(r.review, /2 h 40 min/);
});

test('breaks compare with last week, either way', () => {
  const up = buildReport({ week: week({ 0: { breaks: 8 } }), lastWeek: week({ 0: { breaks: 5 } }), streak: 0, settings: DEFAULTS, now: NOW });
  assert.equal(up.added[0], '8 breaks taken, up from 5');
  const down = buildReport({ week: week({ 0: { breaks: 2 } }), lastWeek: week({ 0: { breaks: 5 } }), streak: 0, settings: DEFAULTS, now: NOW });
  assert.ok(down.removed.includes('Down from 5 breaks the week before'));
});

test('skips show a pattern only when there is one', () => {
  assert.equal(skipPattern(week({ 0: { skippedHours: { 15: 1, 16: 1 } } })), null, 'too few');
  const late = week({ 0: { skippedHours: { 10: 1, 15: 3, 16: 2 } } });
  assert.equal(skipPattern(late).hour, 15);
  assert.match(tip(late), /after 3 pm/);
  assert.equal(tip(week()), '');
});

test('a suggestion shortens the interval and has a floor', () => {
  const r = report({ 0: { breaks: 2, longestSitMin: 130 } });
  assert.deepEqual(r.suggestion.patch, { stand: { everyMin: 25 } });
  const low = merge(DEFAULTS, { stand: { everyMin: 20 }, water: { everyMin: 20 } });
  assert.equal(report({ 0: { breaks: 2, longestSitMin: 130 } }, { settings: low }).suggestion, null);
});

test('a settled suggestion stays settled for that week only', () => {
  const key = report({ 0: { breaks: 2, longestSitMin: 130 } }).key;
  const settled = merge(DEFAULTS, { report: { reviewed: { key, outcome: 'applied' } } });
  const r = report({ 0: { breaks: 2, longestSitMin: 130 } }, { settings: settled });
  assert.equal(r.suggestion, null);
  assert.equal(r.reviewed, 'applied');
  const older = merge(DEFAULTS, { report: { reviewed: { key: '2020-W1', outcome: 'applied' } } });
  assert.ok(report({ 0: { breaks: 2, longestSitMin: 130 } }, { settings: older }).suggestion);
});

test('the chart covers working hours and anything outside them', () => {
  const { chart } = report({ 0: { breaks: 1, hours: { 7: 1 }, skipped: 1, skippedHours: { 21: 1 } } });
  assert.equal(chart[0].hour, 7);
  assert.equal(chart[0].taken, 1);
  assert.equal(chart[chart.length - 1].hour, 21);
  assert.equal(chart[chart.length - 1].skipped, 1);
});

test('commit insight compares skip days only when the numbers say so', () => {
  const days = week({ 0: { skipped: 4, breaks: 1 } });
  const commit = (date, hour, fix) => ({ date, hour, fix });
  const many = [commit(days[0].date, 20, true), commit(days[0].date, 21, true), commit(days[1].date, 20, true), commit(days[2].date, 20, true)];
  assert.match(commitInsight(many, days), /6 times as many "fix" commits/);
  const few = [commit(days[0].date, 20, true), commit(days[0].date, 21, true), commit(days[1].date, 20, true)];
  assert.equal(commitInsight(few, days), '3 commits and 1 break this week.', 'too few to compare');
  assert.equal(commitInsight([commit(days[1].date, 10, false)], days), '1 commit and 1 break this week.');
  assert.equal(commitInsight([], days), null);
  assert.equal(commitInsight(null, days), null);
});

test('git log lines parse, and fixes are spotted', () => {
  const fixed = parseLine('2026-10-30T20:15:00+05:30\tFix the tray\twith a tab');
  assert.equal(fixed.fix, true);
  assert.match(fixed.date, /^2026-10-\d\d$/);
  assert.equal(parseLine('2026-10-30T20:15:00+05:30\tAdd prefix support').fix, false);
});
