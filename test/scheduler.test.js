const test = require('node:test');
const assert = require('node:assert/strict');
const { Scheduler, inWorkHours, MEETING_GRACE_MS } = require('../src/main/scheduler');
const { DEFAULTS, merge } = require('../src/main/store');

const MIN = 60 * 1000;

function setup(patch = {}) {
  const settings = merge(DEFAULTS, patch);
  const scheduler = new Scheduler(() => settings, 0);
  const events = [];
  for (const name of ['stand', 'stand-waiting', 'water']) {
    scheduler.on(name, () => events.push(name));
  }
  return { scheduler, events, settings };
}

test('break is due after the interval', () => {
  const { scheduler, events } = setup({ water: { enabled: false } });
  scheduler.tick(39 * MIN);
  assert.deepEqual(events, []);
  scheduler.tick(40 * MIN);
  assert.deepEqual(events, ['stand']);
  scheduler.tick(41 * MIN);
  assert.deepEqual(events, ['stand'], 'no second break while one is showing');
});

test('finishing a break restarts the timer', () => {
  const { scheduler, events } = setup({ water: { enabled: false } });
  scheduler.tick(40 * MIN);
  scheduler.breakDone(41 * MIN);
  scheduler.tick(80 * MIN);
  assert.equal(events.length, 1);
  scheduler.tick(81 * MIN);
  assert.equal(events.length, 2);
});

test('snooze delays the break', () => {
  const { scheduler, events } = setup({ water: { enabled: false } });
  scheduler.tick(40 * MIN);
  scheduler.snooze(40 * MIN, 5);
  scheduler.tick(44 * MIN);
  assert.equal(events.length, 1);
  scheduler.tick(45 * MIN);
  assert.equal(events.length, 2);
});

test('waits during a call, then breaks after a grace period', () => {
  const { scheduler, events } = setup({ water: { enabled: false } });
  scheduler.tick(40 * MIN, { inMeeting: true });
  assert.deepEqual(events, ['stand-waiting']);
  scheduler.tick(50 * MIN, { inMeeting: true });
  assert.deepEqual(events, ['stand-waiting']);
  scheduler.tick(51 * MIN, { inMeeting: false });
  scheduler.tick(51 * MIN + MEETING_GRACE_MS - 1);
  assert.deepEqual(events, ['stand-waiting']);
  scheduler.tick(51 * MIN + MEETING_GRACE_MS);
  assert.deepEqual(events, ['stand-waiting', 'stand']);
});

test('breaks in a call when waiting is turned off', () => {
  const { scheduler, events } = setup({ water: { enabled: false }, stand: { waitDuringCalls: false } });
  scheduler.tick(40 * MIN, { inMeeting: true });
  assert.deepEqual(events, ['stand']);
});

test('being away counts as a break', () => {
  const { scheduler, events } = setup({ water: { enabled: false } });
  scheduler.tick(30 * MIN, { idleSec: 5 * 60 });
  scheduler.tick(40 * MIN);
  assert.deepEqual(events, []);
  scheduler.tick(70 * MIN);
  assert.deepEqual(events, ['stand']);
});

test('water reminder repeats and can be put off', () => {
  const { scheduler, events } = setup();
  scheduler.tick(30 * MIN);
  assert.deepEqual(events, ['water']);
  scheduler.waterLater(30 * MIN, 10);
  scheduler.tick(39 * MIN);
  assert.deepEqual(events, ['water']);
  scheduler.tick(40 * MIN);
  assert.deepEqual(events, ['water', 'stand', 'water']);
});

test('nothing fires while paused, and timers restart after', () => {
  const { scheduler, events } = setup();
  scheduler.pause(0, 60);
  scheduler.tick(45 * MIN);
  assert.deepEqual(events, []);
  scheduler.resume(60 * MIN);
  scheduler.tick(89 * MIN);
  assert.deepEqual(events, []);
  scheduler.tick(90 * MIN);
  assert.deepEqual(events, ['water']);
});

test('work hours', () => {
  const hours = { enabled: true, days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };
  assert.equal(inWorkHours(hours, new Date(2026, 9, 29, 10, 0)), true); // Thursday
  assert.equal(inWorkHours(hours, new Date(2026, 9, 29, 18, 0)), false);
  assert.equal(inWorkHours(hours, new Date(2026, 9, 31, 10, 0)), false); // Saturday
  assert.equal(inWorkHours({ ...hours, enabled: false }, new Date(2026, 9, 31, 3, 0)), true);
});
