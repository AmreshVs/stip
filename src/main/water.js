const path = require('node:path');
const { BrowserWindow, screen } = require('electron');

const PRELOAD = path.join(__dirname, '..', 'preload.js');
const PAGE = path.join(__dirname, '..', 'renderer', 'water', 'index.html');
const WIDTH = 720;
const CLICK_THROUGH = process.platform !== 'linux';

// A transparent strip down the right edge of the main display: the drop runs
// down it and lands in the orb at the bottom. It never takes focus, and mouse
// clicks pass through everywhere except the orb and its card.
class WaterReminder {
  constructor() {
    this.win = null;
  }

  show() {
    if (this.win) return this.win;
    const area = screen.getPrimaryDisplay().workArea;
    // Linux can't pass clicks through a window, so there it only covers the
    // bottom corner and the drop falls a shorter way.
    const height = CLICK_THROUGH ? area.height : Math.min(area.height, 460);
    this.win = new BrowserWindow({
      x: area.x + area.width - WIDTH,
      y: area.y + area.height - height,
      width: WIDTH,
      height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: { preload: PRELOAD, sandbox: true },
    });
    this.win.setAlwaysOnTop(true, 'floating');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (CLICK_THROUGH) this.win.setIgnoreMouseEvents(true, { forward: true });
    this.win.loadFile(PAGE);
    this.win.webContents.once('did-finish-load', () => {
      this.win.webContents.send('show', {});
      if (!process.env.STIP_SNAPSHOT) this.win.showInactive();
    });
    this.win.on('closed', () => {
      this.win = null;
    });
    return this.win;
  }

  // The page tells us when the pointer is over something clickable.
  setInteractive(on) {
    if (CLICK_THROUGH) this.win?.setIgnoreMouseEvents(!on, { forward: true });
  }

  hide() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  send(state) {
    this.win?.webContents.send('state', state);
  }
}

module.exports = { WaterReminder };
