const { EventEmitter } = require('node:events');

const MIN = 60 * 1000;
// After a call ends, wait a little before covering the screen.
const MEETING_GRACE_MS = 30 * 1000;

function minutesOfDay(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function inWorkHours(workHours, date) {
  if (!workHours.enabled) return true;
  if (!workHours.days.includes(date.getDay())) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  return now >= minutesOfDay(workHours.start) && now < minutesOfDay(workHours.end);
}

// Pure timing logic. The caller feeds it the clock, idle time and meeting
// state on every tick, so it can be tested without Electron.
//
// Events: 'stand' (show the break), 'stand-waiting' (due, but in a call),
// 'water' (show the water reminder), 'status' (something changed).
class Scheduler extends EventEmitter {
  constructor(getSettings, now = Date.now()) {
    super();
    this.getSettings = getSettings;
    this.lastBreakAt = now;
    this.standDueAt = now + this.standEvery();
    this.waterDueAt = now + this.waterEvery();
    this.pausedUntil = 0;
    this.onBreak = false;
    this.waitingForMeeting = false;
    this.meetingEndedAt = 0;
  }

  standEvery() {
    return this.getSettings().stand.everyMin * MIN;
  }

  waterEvery() {
    return this.getSettings().water.everyMin * MIN;
  }

  isPaused(now) {
    return now < this.pausedUntil;
  }

  tick(now, { idleSec = 0, inMeeting = false } = {}) {
    const settings = this.getSettings();
    if (this.onBreak) return;

    if (this.isPaused(now) || !inWorkHours(settings.workHours, new Date(now))) {
      // Nothing is due while paused or off the clock; restart fresh after.
      this.standDueAt = Math.max(this.standDueAt, now + this.standEvery());
      this.waterDueAt = Math.max(this.waterDueAt, now + this.waterEvery());
      return;
    }

    // Being away from the keyboard long enough counts as a break.
    if (settings.stand.resetWhenAway && idleSec >= settings.stand.awayMin * 60) {
      this.lastBreakAt = now;
      this.standDueAt = now + this.standEvery();
      this.waitingForMeeting = false;
      this.emit('status');
    }

    if (now >= this.standDueAt) {
      if (inMeeting && settings.stand.waitDuringCalls) {
        if (!this.waitingForMeeting) {
          this.waitingForMeeting = true;
          this.emit('stand-waiting');
          this.emit('status');
        }
        this.meetingEndedAt = 0;
      } else if (this.waitingForMeeting) {
        if (!this.meetingEndedAt) this.meetingEndedAt = now;
        if (now - this.meetingEndedAt >= MEETING_GRACE_MS) this.startBreak();
      } else {
        this.startBreak();
      }
    }

    if (settings.water.enabled && now >= this.waterDueAt && !inMeeting) {
      this.waterDueAt = now + this.waterEvery();
      this.emit('water');
    }
  }

  startBreak() {
    this.onBreak = true;
    this.waitingForMeeting = false;
    this.meetingEndedAt = 0;
    this.emit('stand');
    this.emit('status');
  }

  breakDone(now) {
    this.onBreak = false;
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
    this.waterDueAt = now + this.waterEvery();
    this.emit('status');
  }

  pause(now, minutes) {
    this.pausedUntil = now + minutes * MIN;
    this.emit('status');
  }

  resume(now) {
    this.pausedUntil = 0;
    this.standDueAt = now + this.standEvery();
    this.waterDueAt = now + this.waterEvery();
    this.emit('status');
  }

  // Settings changed: re-arm the timers from the last break.
  reschedule(now) {
    this.standDueAt = Math.max(now, this.lastBreakAt + this.standEvery());
    this.waterDueAt = Math.min(this.waterDueAt, now + this.waterEvery());
    this.emit('status');
  }

  status(now) {
    return {
      msToStand: Math.max(0, this.standDueAt - now),
      standEveryMs: this.standEvery(),
      sittingMs: now - this.lastBreakAt,
      msToWater: Math.max(0, this.waterDueAt - now),
      pausedUntil: this.isPaused(now) ? this.pausedUntil : 0,
      waitingForMeeting: this.waitingForMeeting,
      onBreak: this.onBreak,
    };
  }
}

module.exports = { Scheduler, inWorkHours, MEETING_GRACE_MS };
