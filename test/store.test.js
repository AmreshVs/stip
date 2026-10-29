const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Settings, Stats } = require('../src/main/store');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stip-'));
}

test('settings merge with defaults and persist', () => {
  const dir = tempDir();
  const settings = new Settings(dir);
  assert.equal(settings.get().stand.everyMin, 40);
  settings.set({ stand: { everyMin: 30 } });
  const reloaded = new Settings(dir);
  assert.equal(reloaded.get().stand.everyMin, 30);
  assert.equal(reloaded.get().stand.breakSec, 60, 'untouched keys keep defaults');
});

test('stats count today and the streak', () => {
  const stats = new Stats(tempDir());
  const day = (d) => new Date(2026, 9, d, 11, 0);
  stats.record('breaks', day(27));
  stats.record('breaks', day(28));
  stats.record('breaks', day(29));
  stats.record('glasses', day(29));
  assert.equal(stats.today(day(29)).breaks, 1);
  assert.equal(stats.today(day(29)).glasses, 1);
  assert.equal(stats.today(day(29)).hours['11'], 1);
  assert.equal(stats.streak(day(29)), 3);
  assert.equal(stats.streak(day(30)), 3, 'today with no break yet keeps yesterday\'s streak');
  assert.equal(stats.streak(day(31)), 0);
});
