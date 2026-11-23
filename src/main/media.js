const { execFile } = require('node:child_process');
const { app, systemPreferences } = require('electron');
const { HIDDEN } = require('./snapshot');

// Pauses music and videos while a break covers the screen, and plays them
// again after. macOS only: it presses the keyboard's play/pause key, which
// goes to whatever is playing (YouTube in a browser, Spotify, Music...).
//
// Pressing that key when nothing plays would start something, so Stip only
// presses it when the system says sound is coming out, and undoes the press
// if it started a player that wasn't playing before.

// Hidden test and snapshot runs leave the real music alone.
const SUPPORTED = process.platform === 'darwin' && !process.mas && !HIDDEN;
// Long enough for a player that wasn't playing to start making sound.
const CHECK_AFTER_MS = 4000;

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

// Processes sending sound to a speaker or headphones right now. Core Audio
// holds a power assertion for each, which `pmset` lists with the owner's pid.
async function playingPids() {
  const out = await run('/usr/bin/pmset', ['-g', 'assertions']);
  const ours = new Set([process.pid, ...app.getAppMetrics().map(({ pid }) => pid)]);
  const pids = new Set();
  let owner = null;
  for (const line of out.split('\n')) {
    if (/^\s*pid \d+\(/.test(line)) owner = { audio: /\(coreaudiod\)/.test(line), pid: null };
    if (!owner?.audio) continue;
    const created = /Created for PID: (\d+)/.exec(line);
    if (created) owner.pid = Number(created[1]);
    if (/Resources:.*\baudio-out\b/.test(line) && owner.pid && !ours.has(owner.pid)) pids.add(owner.pid);
  }
  return pids;
}

// The play/pause media key, as the keyboard sends it.
const PRESS_PLAY_PAUSE = `
ObjC.import('Cocoa');
ObjC.import('CoreGraphics');
for (const flags of [0xa00, 0xb00]) {
  const event = $.NSEvent.otherEventWithTypeLocationModifierFlagsTimestampWindowNumberContextSubtypeData1Data2(
    14, $.NSMakePoint(0, 0), flags, 0, 0, $(), 8, (16 << 16) | flags, -1);
  $.CGEventPost(0, event.CGEvent);
}`;

function pressPlayPause() {
  return run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', PRESS_PLAY_PAUSE]);
}

class Media {
  constructor() {
    this.paused = false;
    this.asked = false;
    this.needsAccess = false;
    this.session = 0;
  }

  get supported() {
    return SUPPORTED;
  }

  // Posting a key press needs Accessibility access.
  allowed(prompt = false) {
    return SUPPORTED && systemPreferences.isTrustedAccessibilityClient(prompt);
  }

  async pause() {
    if (!SUPPORTED || this.paused) return;
    const session = ++this.session;
    const before = await playingPids();
    if (!before.size || session !== this.session) return;
    if (!this.allowed()) {
      this.needsAccess = true;
      return;
    }
    await pressPlayPause();
    // The break ended while the key was on its way: put it back.
    if (session !== this.session) {
      await pressPlayPause();
      return;
    }
    this.paused = true;
    setTimeout(async () => {
      if (session !== this.session || !this.paused) return;
      const after = await playingPids();
      // Something new started playing: the key went to an idle player.
      if ([...after].some((pid) => !before.has(pid))) {
        this.paused = false;
        await pressPlayPause();
      }
    }, CHECK_AFTER_MS);
  }

  async resume() {
    this.session += 1;
    if (this.needsAccess && !this.asked) {
      // Ask once, after the break, so the system dialog isn't hidden under it.
      this.asked = true;
      this.allowed(true);
    }
    this.needsAccess = false;
    if (!this.paused) return;
    this.paused = false;
    await pressPlayPause();
  }
}

module.exports = { Media, playingPids };
