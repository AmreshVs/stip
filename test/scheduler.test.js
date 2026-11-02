const test = require('node:test');
const assert = require('node:assert/strict');
const { Scheduler, inWorkHours, inWaterHours, waterSchedule, nextWorkStart, MEETING_GRACE_MS, FLOW_MAX_WAIT_MS } = require('../src/main/scheduler');
const { DEFAULTS, merge } = require('../src/main/store');

const MIN = 60 * 1000;

// Pinned timings, so the tests don't change when the defaults do.
const BASE = { stand: { everyMin: 40, breakSec: 60, awayMin: 5 }, water: { everyMin: 30 } };

function setup(patch = {}) {
  const settings = merge(merge(DEFAULTS, BASE), patch);
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

test("I'm in a meeting waits even when auto-waiting is off", () => {
  const { scheduler, events } = setup({ water: { enabled: false }, stand: { waitDuringCalls: false } });
  scheduler.tick(40 * MIN);
  scheduler.deferForMeeting();
  scheduler.tick(45 * MIN, { inMeeting: true });
  assert.deepEqual(events, ['stand']);
  scheduler.tick(50 * MIN);
  scheduler.tick(50 * MIN + MEETING_GRACE_MS);
  assert.deepEqual(events, ['stand', 'stand']);
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

test('waking from sleep starts fresh instead of firing at once', () => {
  const { scheduler, events } = setup({ water: { enabled: false } });
  scheduler.restart(300 * MIN);
  scheduler.tick(300 * MIN);
  assert.deepEqual(events, []);
  assert.equal(scheduler.status(300 * MIN).sittingMs, 0);
  scheduler.tick(340 * MIN);
  assert.deepEqual(events, ['stand']);
});

test('work hours', () => {
  const hours = { enabled: true, days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };
  assert.equal(inWorkHours(hours, new Date(2026, 9, 29, 10, 0)), true); // Thursday
  assert.equal(inWorkHours(hours, new Date(2026, 9, 29, 18, 0)), false);
  assert.equal(inWorkHours(hours, new Date(2026, 9, 31, 10, 0)), false); // Saturday
  assert.equal(inWorkHours({ ...hours, enabled: false }, new Date(2026, 9, 31, 3, 0)), true);
});

test('next start of working hours', () => {
  const hours = { enabled: true, days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };
  const thursdayEvening = new Date(2026, 9, 29, 21, 0);
  assert.equal(nextWorkStart(hours, thursdayEvening), new Date(2026, 9, 30, 9, 0).getTime());
  const fridayEvening = new Date(2026, 9, 30, 21, 0);
  assert.equal(nextWorkStart(hours, fridayEvening), new Date(2026, 10, 2, 9, 0).getTime(), 'skips the weekend');
  assert.equal(nextWorkStart({ ...hours, days: [] }, fridayEvening), null);
});

test('snoozes run out after the limit, and a finished break resets them', () => {
  const { scheduler } = setup({ water: { enabled: false }, stand: { maxSnoozes: 2 } });
  assert.equal(scheduler.snoozesLeft(), 2);
  scheduler.tick(40 * MIN);
  scheduler.snooze(40 * MIN, 5);
  scheduler.tick(45 * MIN);
  scheduler.snooze(45 * MIN, 5);
  assert.equal(scheduler.snoozesLeft(), 0);
  scheduler.skip(50 * MIN);
  assert.equal(scheduler.snoozesLeft(), 0, 'skipping is not a finished break');
  scheduler.breakDone(90 * MIN);
  assert.equal(scheduler.snoozesLeft(), 2);
});

test('away time also resets the snooze count', () => {
  const { scheduler } = setup({ water: { enabled: false } });
  scheduler.tick(40 * MIN);
  scheduler.snooze(40 * MIN, 5);
  scheduler.tick(44 * MIN, { idleSec: 5 * 60 });
  assert.equal(scheduler.snoozesLeft(), 2);
});

test('no snooze limit when it is set to 0', () => {
  const { scheduler } = setup({ stand: { maxSnoozes: 0 } });
  for (let i = 0; i < 5; i += 1) scheduler.snooze(i * MIN, 5);
  assert.equal(scheduler.snoozesLeft(), null);
});

test('defaults: 30 minutes sitting, 2 minute breaks, 3 minutes away, 2 snoozes', () => {
  assert.equal(DEFAULTS.stand.everyMin, 30);
  assert.equal(DEFAULTS.stand.breakSec, 120);
  assert.equal(DEFAULTS.stand.awayMin, 3);
  assert.equal(DEFAULTS.stand.maxSnoozes, 2);
});

test('a due break waits for a pause, then starts', () => {
  const { scheduler, events } = setup({ water: { enabled: false }, stand: { waitForFlow: true } });
  scheduler.tick(40 * MIN, { inFlow: true });
  assert.deepEqual(events, []);
  assert.equal(scheduler.status(40 * MIN).waitingForFlow, true);
  scheduler.tick(41 * MIN, { inFlow: false });
  assert.deepEqual(events, ['stand']);
  assert.equal(scheduler.status(41 * MIN).waitingForFlow, false);
});

test('a break waits for a pause for 10 minutes at most', () => {
  const { scheduler, events } = setup({ water: { enabled: false }, stand: { waitForFlow: true } });
  scheduler.tick(40 * MIN, { inFlow: true });
  scheduler.tick(40 * MIN + FLOW_MAX_WAIT_MS - 1, { inFlow: true });
  assert.deepEqual(events, []);
  scheduler.tick(40 * MIN + FLOW_MAX_WAIT_MS, { inFlow: true });
  assert.deepEqual(events, ['stand']);
});

test('being busy changes nothing when waiting for a pause is off', () => {
  const { scheduler, events } = setup({ water: { enabled: false }, stand: { waitForFlow: false } });
  scheduler.tick(40 * MIN, { inFlow: true });
  assert.deepEqual(events, ['stand']);
});

// Monday 2 November 2026.
const at = (hour, minute = 0, day = 2) => new Date(2026, 10, day, hour, minute);

function clocked(patch) {
  const settings = merge(merge(DEFAULTS, BASE), patch);
  const start = at(0).getTime();
  const scheduler = new Scheduler(() => settings, start);
  const events = [];
  for (const name of ['stand', 'water']) scheduler.on(name, () => events.push(name));
  return { scheduler, events, settings };
}

test('water follows the working hours switch until someone chooses', () => {
  const off = merge(DEFAULTS, { workHours: { enabled: false } });
  const on = merge(DEFAULTS, { workHours: { enabled: true } });
  assert.equal(waterSchedule(off), 'always');
  assert.equal(waterSchedule(on), 'work');
  assert.equal(inWaterHours(off, at(23)), true);
  assert.equal(inWaterHours(on, at(23)), false);
});

test('choosing working hours applies them even with the break switch off', () => {
  const settings = merge(DEFAULTS, { water: { schedule: 'work' }, workHours: { enabled: false } });
  assert.equal(inWaterHours(settings, at(10)), true);
  assert.equal(inWaterHours(settings, at(20)), false);
});

test('any time ignores working hours', () => {
  const settings = merge(DEFAULTS, { water: { schedule: 'always' }, workHours: { enabled: true } });
  assert.equal(inWaterHours(settings, at(23)), true);
});

test('custom water hours use their own days and times', () => {
  const settings = merge(DEFAULTS, { water: { schedule: 'custom', hours: { days: [1], start: '08:00', end: '21:00' } } });
  assert.equal(inWaterHours(settings, at(7, 59)), false);
  assert.equal(inWaterHours(settings, at(8)), true);
  assert.equal(inWaterHours(settings, at(21)), false);
  assert.equal(inWaterHours(settings, at(10, 0, 3)), false, 'Tuesday is off');
});

test('custom water hours can run past midnight', () => {
  const settings = merge(DEFAULTS, { water: { schedule: 'custom', hours: { days: [1], start: '22:00', end: '02:00' } } });
  assert.equal(inWaterHours(settings, at(23)), true);
  assert.equal(inWaterHours(settings, at(1, 0, 3)), true, 'Monday night, into Tuesday');
  assert.equal(inWaterHours(settings, at(23, 0, 3)), false, 'Tuesday night is off');
  assert.equal(inWaterHours(settings, at(12)), false);
});

test('water reminds outside working hours when it has its own schedule', () => {
  const { scheduler, events } = clocked({
    water: { schedule: 'always', everyMin: 30 },
    stand: { everyMin: 40 },
    workHours: { enabled: true, days: [1], start: '09:00', end: '18:00' },
  });
  scheduler.tick(at(0, 30).getTime());
  assert.deepEqual(events, ['water']);
});

test('breaks still run while water is off the clock', () => {
  const { scheduler, events } = clocked({
    water: { schedule: 'custom', everyMin: 30, hours: { days: [1], start: '20:00', end: '21:00' } },
    stand: { everyMin: 40 },
  });
  scheduler.tick(at(0, 30).getTime());
  assert.deepEqual(events, []);
  assert.equal(scheduler.status(at(0, 30).getTime()).waterOff, true);
  assert.equal(scheduler.status(at(0, 30).getTime()).waterResumesAt, at(20).getTime());
  scheduler.tick(at(0, 41).getTime());
  assert.deepEqual(events, ['stand']);
});

test('pausing stops water on every schedule', () => {
  const { scheduler, events } = clocked({ water: { schedule: 'always', everyMin: 30 } });
  scheduler.pause(at(0).getTime(), 120);
  scheduler.tick(at(1).getTime());
  assert.deepEqual(events, []);
});

test('no water days means no reminders and no return time', () => {
  const { scheduler } = clocked({ water: { schedule: 'custom', hours: { days: [] } } });
  assert.equal(scheduler.status(at(10).getTime()).waterOff, true);
  assert.equal(scheduler.status(at(10).getTime()).waterResumesAt, null);
});
