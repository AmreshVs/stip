const path = require('node:path');
const { app, ipcMain, powerMonitor, Notification } = require('electron');
const { Settings, Stats } = require('./store');
const { Scheduler } = require('./scheduler');
const { Meeting } = require('./meeting');
const { Flow } = require('./flow');
const { TrayUI } = require('./tray');
const { BreakScreens } = require('./breaks');
const { WaterReminder } = require('./water');
const { SettingsWindow } = require('./settings-window');
const { ReportWindow } = require('./report-window');
const { buildReport, tip } = require('./report');
const { recentCommits } = require('./git-history');
const { snapshot, requestedView, HIDDEN } = require('./snapshot');
const characters = require('../renderer/shared/characters');
const { startCliServer, installCommand } = require('./cli-server');
const { socketPath } = require('../cli');

// Lets dev runs and snapshots keep their settings apart from the real ones.
if (process.env.STIP_USER_DATA) app.setPath('userData', process.env.STIP_USER_DATA);

// Stip lives in the tray, so make sure only one copy runs.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let settings;
let stats;
let scheduler;
let meeting;
let flow;
let tray;
let breaks;
let water;
let settingsWindow;
let reportWindow;
let cliInstallResult = null;

function minutesUntilMidnight(now = new Date()) {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.ceil((midnight - now) / 60000);
}

function state() {
  const now = Date.now();
  return {
    settings: settings.get(),
    status: scheduler.status(now),
    today: stats.today(),
    streak: stats.streak(),
    longestStreak: stats.longestStreak(),
    activeDays: stats.activeDays(),
    daysSinceBreak: stats.daysSinceBreak(),
    week: stats.week(),
    meeting: { manual: meeting.manual(now), active: meeting.active(now), until: meeting.manualUntil },
    platform: process.platform,
    version: app.getVersion(),
    fromStore: Boolean(process.windowsStore),
    cliInstall: cliInstallResult,
    tip: tip(stats.range(14)),
  };
}

// The tray gets every tick; the settings window only real changes, so it
// doesn't redraw under the user's pointer every second.
function broadcast({ includeSettings = true } = {}) {
  const current = state();
  tray.send(current);
  if (includeSettings) {
    settingsWindow.send(current);
    reportWindow.send(current);
  }
}

// The menu bar stays quiet: the icon alone, plus a word for a state that
// matters, and the timer only in the last 30 seconds before a break.
const FINAL_COUNTDOWN_MS = 30 * 1000;

function updateTrayTitle() {
  const now = Date.now();
  const status = scheduler.status(now);
  const clock = fmtClock(status.msToStand);
  const minutes = Math.ceil(status.msToStand / 60000);
  const tooltip = `Stip · next stand in ${minutes} min`;
  const final = settings.get().showCountdown && status.msToStand <= FINAL_COUNTDOWN_MS;
  if (status.pausedUntil) tray.setTitle('Paused', 'Stip · paused');
  else if (status.offHours) tray.setTitle('', 'Stip · outside working hours');
  else if (status.waitingForMeeting) tray.setTitle('In call · break waiting', 'Stip · your break starts after the call');
  else if (status.waitingForFlow) tray.setTitle('Break at next pause', 'Stip · your break starts when you pause');
  else if (meeting.active(now)) tray.setTitle(final ? `In call · ${clock}` : 'In call', `Stip · in a call, next stand in ${minutes} min`);
  else tray.setTitle(final ? clock : '', tooltip);
}

function fmtClock(ms) {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const actions = {
  'stand-now': () => {
    tray.hide();
    scheduler.startBreak();
  },
  'break-finish': ({ how }) => breaks.finish(how),
  sip: () => {
    stats.record('glasses');
    scheduler.sipped(Date.now());
  },
  'tray-size': ({ height }) => tray.resize(height),
  'tray-close': () => tray.hide(),
  'water-now': () => {
    tray.hide();
    if (!breaks.open) water.show();
  },
  'water-hover': ({ over }) => water.setInteractive(over),
  'water-sipped': () => {
    stats.record('glasses');
    scheduler.sipped(Date.now());
  },
  'water-later': () => {
    scheduler.waterLater(Date.now(), 10);
    water.hide();
  },
  'water-close': () => water.hide(),
  'meeting-toggle': () => meeting.setManual(!meeting.manual()),
  pause: ({ minutes }) => {
    scheduler.pause(Date.now(), minutes === 'day' ? minutesUntilMidnight() : Number(minutes));
  },
  resume: () => scheduler.resume(Date.now()),
  settings: () => {
    tray.hide();
    settingsWindow.open(settings.get().theme);
  },
  'settings-set': (patch) => settings.set(patch),
  'report-open': () => {
    tray.hide();
    reportWindow.open(settings.get().theme);
  },
  'report-apply': () => settleSuggestion('applied'),
  'report-dismiss': () => settleSuggestion('dismissed'),
  'report-copy': () => reportWindow.copy(),
  'report-save': () => reportWindow.save(),
  'report-add-folder': async () => {
    const folder = await reportWindow.pickFolder();
    const { folders } = settings.get().report;
    if (folder && !folders.includes(folder)) settings.set({ report: { folders: [...folders, folder] } });
  },
  'report-remove-folder': ({ folder }) => {
    settings.set({ report: { folders: settings.get().report.folders.filter((f) => f !== folder) } });
  },
  'install-cli': () => {
    try {
      const { dir } = installCommand({ exe: process.execPath, cli: path.join(app.getAppPath(), 'src', 'cli.js') });
      cliInstallResult = { ok: true, dir };
    } catch (err) {
      cliInstallResult = { ok: false, error: err.message };
    }
  },
  quit: () => app.quit(),
};

// The `stip` command in the terminal.
function cliCommand({ command, minutes, on }) {
  const now = Date.now();
  switch (command) {
    case 'status':
      return {
        status: scheduler.status(now),
        today: stats.today(),
        streak: stats.streak(),
        meeting: meeting.manual(now),
      };
    case 'break':
      if (scheduler.status(now).onBreak) return { message: 'Already on a break.' };
      handleAction('stand-now');
      return { message: 'Stand up!' };
    case 'water':
      handleAction('water-now');
      return { message: 'Water reminder is up.' };
    case 'sip':
      handleAction('sip');
      return { message: `Logged. ${stats.today().glasses} of ${settings.get().water.goalGlasses} glasses today.` };
    case 'pause':
      handleAction('pause', { minutes });
      return { message: minutes === 'day' ? 'Paused for today.' : `Paused for ${minutes} min.` };
    case 'resume':
      handleAction('resume');
      return { message: 'Reminders are back on.' };
    case 'meeting':
      meeting.setManual(on);
      broadcast();
      return { message: on ? 'Meeting mode on.' : 'Meeting mode off.' };
    default:
      return { error: 'Unknown command.' };
  }
}

async function report() {
  const current = settings.get();
  const { folders } = current.report;
  const commits = folders.length ? await recentCommits(folders) : null;
  return {
    report: buildReport({
      week: stats.range(7),
      lastWeek: stats.range(7, 7),
      streak: stats.streak(),
      settings: current,
      commits,
    }),
    folders,
    theme: current.theme,
  };
}

// Applying or dismissing a suggestion settles it for the week.
async function settleSuggestion(outcome) {
  const { report: current } = await report();
  if (!current.suggestion) return;
  settings.set({
    ...(outcome === 'applied' ? current.suggestion.patch : {}),
    report: { reviewed: { key: current.key, outcome } },
  });
}

function announceUnlock(before, after) {
  const { character } = settings.get().water;
  const unlock = characters.unlockedBetween(character, before, after);
  if (!unlock || HIDDEN || !Notification.isSupported()) return;
  const { name } = characters.list.find(({ id }) => id === character);
  new Notification({ title: `${name} earned ${unlock}`, body: `That's ${after} days with a break. Nice work.`, silent: true }).show();
}

function onBreakFinished(how) {
  const now = Date.now();
  if (how === 'done') {
    const before = stats.activeDays();
    stats.record('breaks');
    announceUnlock(before, stats.activeDays());
    scheduler.breakDone(now);
  } else if (how === 'snooze') {
    stats.record('snoozed');
    scheduler.snooze(now, 5);
  } else if (how === 'meeting') {
    meeting.setManual(true);
    scheduler.deferForMeeting();
  } else {
    stats.record('skipped');
    scheduler.skip(now);
  }
  broadcast();
}

function applyLoginItem(next) {
  // Store apps can't set this themselves; Windows' Startup apps page does it.
  if (process.env.STIP_USER_DATA || process.windowsStore) return;
  if (app.getLoginItemSettings().openAtLogin !== next.launchAtLogin) {
    app.setLoginItemSettings({ openAtLogin: next.launchAtLogin });
  }
}

function handleAction(name, payload = {}) {
  const action = actions[name];
  if (!action) return;
  action(payload);
  broadcast();
}

const ready = app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.hide();

  const dir = app.getPath('userData');
  settings = new Settings(dir);
  stats = new Stats(dir);
  scheduler = new Scheduler(() => settings.get());
  flow = new Flow();
  meeting = new Meeting({ onProcesses: (names) => flow.updateProcesses(names) });
  meeting.start();
  tray = new TrayUI({ onAction: handleAction, getState: state });
  tray.preload();
  breaks = new BreakScreens({ onFinish: onBreakFinished });
  water = new WaterReminder();
  settingsWindow = new SettingsWindow();
  reportWindow = new ReportWindow();
  scheduler.on('stand', () => {
    water.hide();
    breaks.show(settings.get(), scheduler.status(Date.now()));
  });
  scheduler.on('stand-waiting', () => {
    if (!Notification.isSupported()) return;
    new Notification({
      title: 'Stand break is waiting for you',
      body: "You're on a call, so it starts 30 seconds after the call ends.",
      silent: true,
    }).show();
  });
  scheduler.on('water', () => {
    if (!breaks.open) water.show();
  });

  // Test and snapshot runs keep their hands off the real command's socket.
  if (!process.env.STIP_USER_DATA || process.env.STIP_SOCKET) startCliServer(socketPath(), cliCommand);

  ipcMain.handle('state', () => state());
  ipcMain.handle('report', () => report());
  ipcMain.on('act', (_event, name, payload) => handleAction(name, payload));

  settings.on('change', (next) => {
    scheduler.reschedule(Date.now());
    applyLoginItem(next);
    broadcast();
  });
  stats.on('change', broadcast);
  for (const event of ['resume', 'unlock-screen']) {
    powerMonitor.on(event, () => scheduler.restart(Date.now()));
  }

  setInterval(() => {
    const now = Date.now();
    const idleSec = powerMonitor.getSystemIdleTime();
    flow.note(idleSec);
    scheduler.tick(now, { idleSec, inMeeting: meeting.active(now), inFlow: flow.active() });
    const sitting = scheduler.status(now);
    if (!sitting.pausedUntil && !sitting.offHours && !sitting.onBreak) {
      stats.noteSit(Math.floor(sitting.sittingMs / 60000));
    }
    updateTrayTitle();
    broadcast({ includeSettings: false });
  }, 1000);
  updateTrayTitle();
  showRequestedView();
});

async function showRequestedView() {
  const view = requestedView();
  if (!view) return;
  const [name, theme] = view.split(':');
  if (theme) settings.set({ theme });
  let win;
  if (name === 'break') {
    scheduler.startBreak();
    win = breaks.primary;
  } else if (name === 'water') {
    win = water.show();
  } else if (name === 'report') {
    win = reportWindow.open(settings.get().theme);
  } else if (name.startsWith('settings')) {
    // settings.water opens straight on the Water page.
    const page = name.split('.')[1];
    win = settingsWindow.open(settings.get().theme);
    if (page) {
      win.webContents.once('did-finish-load', () => {
        win.webContents.executeJavaScript(`document.querySelector('.nav[data-page="${page}"]').click()`);
      });
    }
  } else {
    // tray.meeting opens the tray with meeting mode on.
    if (name === 'tray.meeting') meeting.setManual(true);
    win = tray.open();
  }
  if (process.env.STIP_SNAPSHOT) {
    await snapshot(win, process.env.STIP_SNAPSHOT);
    app.quit();
  }
}

// Opening Stip again while it's running shows the panel.
app.on('second-instance', () => tray?.open());

// Keep running in the tray when windows close.
app.on('window-all-closed', () => {});

// The end-to-end test drives the running app through these.
module.exports = {
  ready: ready.then(() => ({ settings, stats, scheduler, meeting, tray, breaks, water, settingsWindow, reportWindow, handleAction })),
};
