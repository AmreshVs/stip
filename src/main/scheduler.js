const { EventEmitter } = require('node:events');

const MIN = 60 * 1000;
// After a call ends, wait a little before covering the screen.
const MEETING_GRACE_MS = 30 * 1000;
// A break waits for a pause in your work, but not forever.
const FLOW_MAX_WAIT_MS = 10 * MIN;
// Catching up on water never nags more often than this.
const WATER_MIN_GAP_MS = 15 * MIN;
// No input for this long means you've stepped away (lunch, a walk). Water
// reminders wait for you, and greet you shortly after you're back.
const WATER_AWAY_SEC = 10 * 60;
const WATER_WELCOME_MS = 2 * MIN;

function minutesOfDay(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Whether a time falls in a window of days and hours. An end before the start
// runs past midnight, and counts as part of the day it began on.
function inWindow({ days, start, end }, date) {
  const now = date.getHours() * 60 + date.getMinutes();
  const from = minutesOfDay(start);
  const to = minutesOfDay(end);
  const today = date.getDay();
  if (from === to) return days.includes(today);
  if (from < to) return days.includes(today) && now >= from && now < to;
  if (now >= from) return days.includes(today);
  return now < to && days.includes((today + 6) % 7);
}

function inWorkHours(workHours, date) {
  return !workHours.enabled || inWindow(workHours, date);
}

// Water can run any time, in working hours, or on its own hours. Until someone
// chooses, it follows the working hours switch, as it always has.
function waterSchedule({ water, workHours }) {
  return water.schedule || (workHours.enabled ? 'work' : 'always');
}

function inWaterHours(settings, date) {
  const schedule = waterSchedule(settings);
  if (schedule === 'custom') return inWindow(settings.water.hours, date);
  if (schedule === 'work') return inWindow(settings.workHours, date);
  return true;
}

function nextWaterStart(settings, date) {
  const schedule = waterSchedule(settings);
  if (schedule === 'always') return null;
  return nextWorkStart(schedule === 'custom' ? settings.water.hours : settings.workHours, date);
}

// Today's water window as timestamps, for pacing the daily goal. 'Always'
// still paces over the custom hours' times, since nobody drinks all night.
function waterWindow(settings, date) {
  const schedule = waterSchedule(settings);
  const hours = schedule === 'work' ? settings.workHours : settings.water.hours;
  const at = (hhmm, offsetDays = 0) => {
    const day = new Date(date);
    day.setDate(day.getDate() + offsetDays);
    const [h, m] = hhmm.split(':').map(Number);
    day.setHours(h, m, 0, 0);
    return day.getTime();
  };
  let start = at(hours.start);
  let end = at(hours.end);
  if (end <= start) {
    // Runs past midnight (or all day): pick the stretch that holds now.
    if (date.getTime() < end) start = at(hours.start, -1);
    else end = at(hours.end, 1);
  }
  return { start, end };
}

// Where you stand against the daily goal: how many glasses you'd have had by
// now at an even pace, and the gap that fits what's left in the time left.
function waterPace(settings, glasses, now) {
  const { goalGlasses: goal, everyMin } = settings.water;
  const base = everyMin * MIN;
  const { start, end } = waterWindow(settings, new Date(now));
  const left = goal - glasses;
  if (left <= 0 || now < start || now >= end) return { behind: 0, gapMs: base };
  const expected = Math.floor((goal * (now - start)) / (end - start));
  const paced = (end - now) / left;
  return {
    behind: Math.max(0, expected - glasses),
    gapMs: Math.max(Math.min(base, WATER_MIN_GAP_MS), Math.min(base, paced)),
  };
}

// When working hours next begin, as a timestamp.
function nextWorkStart(workHours, date) {
  const [h, m] = workHours.start.split(':').map(Number);
  for (let i = 0; i <= 7; i += 1) {
    const day = new Date(date);
    day.setDate(day.getDate() + i);
    day.setHours(h, m, 0, 0);
    if (day > date && workHours.days.includes(day.getDay())) return day.getTime();
  }
  return null;
}

// Pure timing logic. The caller feeds it the clock, idle time and meeting
// state on every tick, so it can be tested without Electron.
//
// Events: 'stand' (show the break), 'stand-waiting' (due, but in a call),
// 'water' (show the water reminder), 'status' (something changed).
class Scheduler extends EventEmitter {
  // getGlasses, when given, returns today's glasses so water can catch up.
  constructor(getSettings, now = Date.now(), { getGlasses = null } = {}) {
    super();
    this.getSettings = getSettings;
    this.getGlasses = getGlasses;
    this.waterAway = false;
    this.lastBreakAt = now;
    this.standDueAt = now + this.standEvery();
    this.waterDueAt = now + this.waterEvery();
    this.pausedUntil = 0;
    this.onBreak = false;
    this.waitingForMeeting = false;
    this.meetingEndedAt = 0;
    this.snoozeCount = 0;
    this.flowWaitStartedAt = 0;
  }

  standEvery() {
    return this.getSettings().stand.everyMin * MIN;
  }

  // The gap to the next water reminder. Behind on the goal (say after a long
  // lunch), it shrinks so what's left still fits in the day.
  waterEvery(now) {
    const settings = this.getSettings();
    const base = settings.water.everyMin * MIN;
    if (now === undefined || !this.catchingUp(settings)) return base;
    return waterPace(settings, this.getGlasses(), now).gapMs;
  }

  catchingUp(settings) {
    return Boolean(this.getGlasses && settings.water.catchUp);
  }

  waterBehind(now) {
    const settings = this.getSettings();
    if (!this.getGlasses || !settings.water.enabled) return 0;
    return waterPace(settings, this.getGlasses(), now).behind;
  }

  // Back at the desk and behind on water: ask soon, not a full gap later.
  welcomeBack(now) {
    const settings = this.getSettings();
    const soon = now + WATER_WELCOME_MS;
    const next = this.catchingUp(settings) && this.waterBehind(now) > 0 ? soon : now + this.waterEvery(now);
    this.waterDueAt = Math.max(soon, Math.min(this.waterDueAt, next));
  }

  isPaused(now) {
    return now < this.pausedUntil;
  }

  tick(now, { idleSec = 0, inMeeting = false, inFlow = false } = {}) {
    const settings = this.getSettings();
    if (this.onBreak) return;

    // Nothing is due while paused or off the clock; restart fresh after.
    const paused = this.isPaused(now);
    if (paused || !inWorkHours(settings.workHours, new Date(now))) {
      this.standDueAt = Math.max(this.standDueAt, now + this.standEvery());
    } else {
      this.tickStand(now, settings, { idleSec, inMeeting, inFlow });
    }

    if (paused || !inWaterHours(settings, new Date(now))) {
      this.waterDueAt = Math.max(this.waterDueAt, now + this.waterEvery(now));
      this.waterAway = false;
    } else if (idleSec >= WATER_AWAY_SEC) {
      // Nobody's there to drink; hold the reminder until they're back.
      this.waterAway = true;
    } else if (this.waterAway) {
      this.waterAway = false;
      this.welcomeBack(now);
      this.emit('status');
    } else if (settings.water.enabled && now >= this.waterDueAt && !inMeeting) {
      this.waterDueAt = now + this.waterEvery(now);
      this.emit('water');
    }
  }

  tickStand(now, settings, { idleSec, inMeeting, inFlow }) {
    // Being away from the keyboard long enough counts as a break.
    if (settings.stand.resetWhenAway && idleSec >= settings.stand.awayMin * 60) {
      this.lastBreakAt = now;
      this.standDueAt = now + this.standEvery();
      this.waitingForMeeting = false;
      this.snoozeCount = 0;
      this.emit('status');
    }

    if (now >= this.standDueAt) {
      // Saying "I'm in a meeting" always waits, even with auto-waiting off.
      if (inMeeting && (settings.stand.waitDuringCalls || this.waitingForMeeting)) {
        if (!this.waitingForMeeting) {
          this.waitingForMeeting = true;
          this.emit('stand-waiting');
          this.emit('status');
        }
        this.meetingEndedAt = 0;
      } else if (this.waitingForMeeting) {
        if (!this.meetingEndedAt) this.meetingEndedAt = now;
        if (now - this.meetingEndedAt >= MEETING_GRACE_MS) this.startBreak();
      } else if (settings.stand.waitForFlow && inFlow && !this.flowWaitOver(now)) {
        if (!this.flowWaitStartedAt) {
          this.flowWaitStartedAt = now;
          this.emit('status');
        }
      } else {
        this.startBreak();
      }
    } else {
      this.flowWaitStartedAt = 0;
    }
  }

  flowWaitOver(now) {
    return this.flowWaitStartedAt > 0 && now - this.flowWaitStartedAt >= FLOW_MAX_WAIT_MS;
  }

  startBreak() {
    this.onBreak = true;
    this.flowWaitStartedAt = 0;
    this.waitingForMeeting = false;
    this.meetingEndedAt = 0;
    this.emit('stand');
    this.emit('status');
  }

  breakDone(now) {
    this.onBreak = false;
    this.snoozeCount = 0;
    this.lastBreakAt = now;
    this.standDueAt = now + this.standEvery();
    this.emit('status');
  }

  // Skip this break but keep the sitting time running.
  skip(now) {
    this.onBreak = false;
    this.waitingForMeeting = false;
    this.standDueAt = now + this.standEvery();
    this.emit('status');
  }

  snooze(now, minutes) {
    this.onBreak = false;
    this.snoozeCount += 1;
    this.waitingForMeeting = false;
    this.standDueAt = now + minutes * MIN;
    this.emit('status');
  }

  // "I'm in a meeting": wait until the call ends, then break.
  deferForMeeting() {
    this.onBreak = false;
    this.waitingForMeeting = true;
    this.meetingEndedAt = 0;
    this.emit('status');
  }

  waterLater(now, minutes) {
    this.waterDueAt = now + minutes * MIN;
    this.emit('status');
  }

  sipped(now) {
    this.waterDueAt = now + this.waterEvery(now);
    this.emit('status');
  }

  pause(now, minutes) {
    this.pausedUntil = now + minutes * MIN;
    this.emit('status');
  }

  resume(now) {
    this.pausedUntil = 0;
    this.standDueAt = now + this.standEvery();
    this.waterDueAt = now + this.waterEvery(now);
    this.emit('status');
  }

  // After sleep or a locked screen the user was away, so start fresh
  // instead of firing an overdue break the moment they come back.
  restart(now) {
    if (this.onBreak) return;
    this.lastBreakAt = now;
    this.standDueAt = now + this.standEvery();
    this.waterDueAt = now + this.waterEvery(now);
    this.welcomeBack(now);
    this.waitingForMeeting = false;
    this.snoozeCount = 0;
    this.emit('status');
  }

  // How many more snoozes are allowed in a row, or null for no limit.
  snoozesLeft() {
    const max = this.getSettings().stand.maxSnoozes;
    return max ? Math.max(0, max - this.snoozeCount) : null;
  }

  // Settings changed: re-arm the timers from the last break.
  reschedule(now) {
    this.standDueAt = Math.max(now, this.lastBreakAt + this.standEvery());
    this.waterDueAt = Math.min(this.waterDueAt, now + this.waterEvery(now));
    this.emit('status');
  }

  status(now) {
    const settings = this.getSettings();
    const { workHours } = settings;
    const waterOff = !inWaterHours(settings, new Date(now));
    const offHours = !inWorkHours(workHours, new Date(now));
    return {
      offHours,
      resumesAt: offHours ? nextWorkStart(workHours, new Date(now)) : 0,
      msToStand: Math.max(0, this.standDueAt - now),
      standEveryMs: this.standEvery(),
      sittingMs: now - this.lastBreakAt,
      msToWater: Math.max(0, this.waterDueAt - now),
      waterBehind: waterOff ? 0 : this.waterBehind(now),
      waterOff,
      waterResumesAt: waterOff ? nextWaterStart(settings, new Date(now)) : 0,
      pausedUntil: this.isPaused(now) ? this.pausedUntil : 0,
      waitingForMeeting: this.waitingForMeeting,
      waitingForFlow: this.flowWaitStartedAt > 0,
      onBreak: this.onBreak,
      snoozesLeft: this.snoozesLeft(),
    };
  }
}

module.exports = {
  Scheduler,
  inWorkHours,
  inWaterHours,
  waterSchedule,
  waterWindow,
  waterPace,
  nextWorkStart,
  MEETING_GRACE_MS,
  FLOW_MAX_WAIT_MS,
  WATER_AWAY_SEC,
  WATER_WELCOME_MS,
};
