const path = require('node:path');
const { app, BrowserWindow, screen } = require('electron');
const { HIDDEN } = require('./snapshot');

const PRELOAD = path.join(__dirname, '..', 'preload.js');
const PAGE = path.join(__dirname, '..', 'renderer', 'break', 'index.html');
// If the page never reports back, close the break anyway.
const FAILSAFE_MS = 5000;

// One full-screen window per display. The primary display gets the timer
// and buttons; the others get a meme.
class BreakScreens {
  constructor({ onFinish }) {
    this.onFinish = onFinish;
    this.windows = [];
    this.failsafe = null;
    this.memeOffset = Math.floor(Math.random() * 1000);
  }

  get open() {
    return this.windows.length > 0;
  }

  show(settings) {
    if (this.open) return;
    const primary = screen.getPrimaryDisplay();
    const displays = settings.stand.coverAllDisplays ? screen.getAllDisplays() : [primary];
    const endsAt = Date.now() + settings.stand.breakSec * 1000;
    this.memeOffset += displays.length + 1;

    displays.forEach((display, index) => {
      const win = new BrowserWindow({
        ...display.bounds,
        show: false,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        enableLargerThanScreen: true,
        skipTaskbar: true,
        backgroundColor: settings.theme === 'aurora' ? '#05070f' : '#141414',
        webPreferences: { preload: PRELOAD, sandbox: true },
      });
      // Sit above full-screen apps, the dock and the menu bar.
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.setBounds(display.bounds);

      const isPrimary = display.id === primary.id;
      win.loadFile(PAGE);
      win.webContents.once('did-finish-load', () => {
        win.webContents.send('show', {
          role: isPrimary ? 'main' : 'meme',
          endsAt,
          breakSec: settings.stand.breakSec,
          strictness: settings.stand.strictness,
          memeIndex: this.memeOffset + index,
          displayIndex: index + 1,
          displayCount: displays.length,
        });
        if (HIDDEN) return;
        win.showInactive();
        if (isPrimary) {
          // Tray apps aren't active by default; take focus so Esc reaches us.
          if (process.platform === 'darwin') app.focus({ steal: true });
          win.show();
          win.focus();
        }
      });
      this.windows.push(win);
      if (isPrimary) this.primary = win;
    });

    clearTimeout(this.failsafe);
    this.failsafe = setTimeout(() => this.finish('done'), endsAt - Date.now() + FAILSAFE_MS);
  }

  // How the break ended: 'done', 'skip', 'snooze' or 'meeting'.
  finish(how) {
    if (!this.open) return;
    clearTimeout(this.failsafe);
    for (const win of this.windows) {
      if (!win.isDestroyed()) win.destroy();
    }
    this.windows = [];
    this.primary = null;
    this.onFinish(how);
  }
}

module.exports = { BreakScreens };
