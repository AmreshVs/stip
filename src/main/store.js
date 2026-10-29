const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const DEFAULTS = {
  theme: 'flat',
  sound: true,
  stand: {
    everyMin: 40,
    breakSec: 60,
    strictness: 'balanced',
    coverAllDisplays: true,
    waitDuringCalls: true,
    resetWhenAway: true,
    awayMin: 5,
  },
  water: {
    enabled: true,
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

const EMPTY_DAY = { breaks: 0, skipped: 0, glasses: 0, hours: {} };

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
}

module.exports = { Settings, Stats, DEFAULTS, merge, dayKey };
