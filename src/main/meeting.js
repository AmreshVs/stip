const { execFile } = require('node:child_process');

// Processes that only run while a call is live. Zoom spawns CptHost when
// you join a meeting and quits it when you leave.
const CALL_PROCESSES = [/(^|\/)CptHost(\.exe)?$/i];

function listProcesses() {
  return new Promise((resolve) => {
    const [cmd, args] =
      process.platform === 'win32' ? ['tasklist', ['/fo', 'csv', '/nh']] : ['ps', ['-A', '-o', 'comm=']];
    execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);
      const names = stdout
        .split(/\r?\n/)
        .map((line) => (process.platform === 'win32' ? line.split('","')[0].replace(/^"/, '') : line.trim()))
        .filter(Boolean);
      resolve(names);
    });
  });
}

// Tracks whether the user is in a call: either they said so (meeting mode),
// or a known call process is running.
class Meeting {
  constructor() {
    this.manualUntil = 0;
    this.autoDetected = false;
    this.timer = null;
  }

  start(pollMs = 15000) {
    const poll = async () => {
      const names = await listProcesses();
      this.autoDetected = names.some((name) => CALL_PROCESSES.some((re) => re.test(name)));
    };
    poll();
    this.timer = setInterval(poll, pollMs);
  }

  stop() {
    clearInterval(this.timer);
  }

  // Meeting mode switches itself off after a while in case it's forgotten.
  setManual(on, now = Date.now(), maxMinutes = 90) {
    this.manualUntil = on ? now + maxMinutes * 60 * 1000 : 0;
  }

  manual(now = Date.now()) {
    return now < this.manualUntil;
  }

  active(now = Date.now()) {
    return this.manual(now) || this.autoDetected;
  }
}

module.exports = { Meeting };
