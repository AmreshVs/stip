// Spots when you're deep in something, so a break can wait for a natural
// pause. It only ever sees how long the computer has been idle and the names
// of running programs, never what you type.
const WINDOW_SEC = 60;
const ACTIVE_IDLE_SEC = 3;
const BUSY_SEC = 30;
const PAUSE_SEC = 10;

// Compilers and build tools that only run while a build is going.
const BUILD_PROCESSES = [
  /(^|[/\\])(cargo|rustc|xcodebuild|swiftc|clang\+?\+?|gcc|g\+\+|mvn|gradle|msbuild|ninja|make|bazel)(\.exe)?$/i,
];

class Flow {
  constructor() {
    this.samples = [];
    this.building = false;
  }

  // Called once a second with the system idle time.
  note(idleSec) {
    this.idleSec = idleSec;
    this.samples.push(idleSec < ACTIVE_IDLE_SEC);
    if (this.samples.length > WINDOW_SEC) this.samples.shift();
  }

  updateProcesses(names) {
    this.building = names.some((name) => BUILD_PROCESSES.some((re) => re.test(name)));
  }

  // Busy for most of the last minute and hasn't paused yet, or mid-build.
  active() {
    const busy = this.samples.filter(Boolean).length >= BUSY_SEC && this.idleSec < PAUSE_SEC;
    return busy || this.building;
  }
}

module.exports = { Flow };
