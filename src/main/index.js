const { app, ipcMain, powerMonitor, Notification } = require('electron');
const { Settings, Stats } = require('./store');
const { Scheduler } = require('./scheduler');
const { Meeting } = require('./meeting');
const { TrayUI } = require('./tray');
const { BreakScreens } = require('./breaks');
const { WaterReminder } = require('./water');
const { SettingsWindow } = require('./settings-window');
const { snapshot, requestedView } = require('./snapshot');

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
let tray;
let breaks;
let water;
let settingsWindow;

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
    week: stats.week(),
    meeting: { manual: meeting.manual(now), active: meeting.active(now) },
    platform: process.platform,
  };
}

// The tray gets every tick; the settings window only real changes, so it
// doesn't redraw under the user's pointer every second.
function broadcast({ includeSettings = true } = {}) {
  const current = state();
  tray.send(current);
  if (includeSettings) settingsWindow.send(current);
}

function updateTrayTitle() {
  const { status } = state();
  if (status.pausedUntil) tray.setTitle('Paused');
  else if (status.waitingForMeeting) tray.setTitle('Call');
  else tray.setTitle(fmtClock(status.msToStand));
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
  quit: () => app.quit(),
};

function onBreakFinished(how) {
  const now = Date.now();
  if (how === 'done') {
    stats.record('breaks');
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
  if (process.env.STIP_USER_DATA) return;
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
  meeting = new Meeting();
  meeting.start();
  tray = new TrayUI({ onAction: handleAction });
  breaks = new BreakScreens({ onFinish: onBreakFinished });
  water = new WaterReminder();
  settingsWindow = new SettingsWindow();
  scheduler.on('stand', () => {
    water.hide();
    breaks.show(settings.get());
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

  ipcMain.handle('state', () => state());
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
    scheduler.tick(now, {
      idleSec: powerMonitor.getSystemIdleTime(),
      inMeeting: meeting.active(now),
    });
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
    win = tray.open();
  }
  if (process.env.STIP_SNAPSHOT) {
    await snapshot(win, process.env.STIP_SNAPSHOT);
    app.quit();
  }
}

// Keep running in the tray when windows close.
app.on('window-all-closed', () => {});

// The end-to-end test drives the running app through these.
module.exports = {
  ready: ready.then(() => ({ settings, stats, scheduler, meeting, tray, breaks, water, settingsWindow, handleAction })),
};
