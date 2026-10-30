const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const DEFAULTS = {
  theme: 'flat',
  sound: true,
  launchAtLogin: false,
  stand: {
    everyMin: 30,
    breakSec: 120,
    strictness: 'balanced',
    coverAllDisplays: true,
    waitDuringCalls: true,
    resetWhenAway: true,
    awayMin: 3,
    // Snoozes in a row before the break can't be put off. 0 means no limit.
    maxSnoozes: 2,
  },
  water: {
    enabled: true,
    dimScreen: true,
    everyMin: 30,
    goalGlasses: 8,
    glassMl: 250,
  },
  workHours: {
    enabled: false,
    days: [1, 2, 3, 4, 5],
    start: '09:00',
    end: '18:00',
  },
};

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function merge(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    out[key] = isObject(value) && isObject(base[key]) ? merge(base[key], value) : value;
  }
  return out;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

class Settings extends EventEmitter {
  constructor(dir) {
    super();
    this.file = path.join(dir, 'settings.json');
    this.data = merge(DEFAULTS, readJson(this.file, {}));
  }

  get() {
    return this.data;
  }

  set(patch) {
    this.data = merge(this.data, patch);
    writeJson(this.file, this.data);
    this.emit('change', this.data);
    return this.data;
  }
}

function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const EMPTY_DAY = { breaks: 0, skipped: 0, snoozed: 0, glasses: 0, hours: {} };
const DAY_MS = 24 * 60 * 60 * 1000;

class Stats extends EventEmitter {
  constructor(dir) {
    super();
    this.file = path.join(dir, 'stats.json');
    this.days = readJson(this.file, {});
  }

  today(now = new Date()) {
    return { ...EMPTY_DAY, ...this.days[dayKey(now)] };
  }

  record(kind, now = new Date()) {
    const key = dayKey(now);
    const day = { ...EMPTY_DAY, ...this.days[key] };
    day[kind] += 1;
    if (kind === 'breaks') {
      const hour = String(now.getHours());
      day.hours = { ...day.hours, [hour]: (day.hours[hour] || 0) + 1 };
    }
    this.days[key] = day;
    writeJson(this.file, this.days);
    this.emit('change');
  }

  // Days in a row, ending today or yesterday, with at least one break taken.
  streak(now = new Date()) {
    const cursor = new Date(now);
    if (!(this.days[dayKey(cursor)]?.breaks > 0)) cursor.setDate(cursor.getDate() - 1);
    let count = 0;
    while (this.days[dayKey(cursor)]?.breaks > 0) {
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }

  longestStreak() {
    let best = 0;
    let run = 0;
    let previous = null;
    for (const key of Object.keys(this.days).sort()) {
      if (!(this.days[key].breaks > 0)) continue;
      const time = new Date(`${key}T12:00:00`).getTime();
      run = previous !== null && Math.round((time - previous) / DAY_MS) === 1 ? run + 1 : 1;
      previous = time;
      best = Math.max(best, run);
    }
    return best;
  }

  // The last seven days, oldest first, with totals and the busiest hour.
  week(now = new Date()) {
    const days = [];
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      days.push({ date: dayKey(date), weekday: date.getDay(), ...EMPTY_DAY, ...this.days[dayKey(date)] });
    }
    const totals = { breaks: 0, skipped: 0, snoozed: 0, glasses: 0 };
    const hours = {};
    for (const day of days) {
      for (const kind of Object.keys(totals)) totals[kind] += day[kind];
      for (const [hour, count] of Object.entries(day.hours)) hours[hour] = (hours[hour] || 0) + count;
    }
    const best = Object.entries(hours).sort((a, b) => b[1] - a[1])[0];
    return { days, totals, bestHour: best ? Number(best[0]) : null };
  }
}

module.exports = { Settings, Stats, DEFAULTS, merge, dayKey };
