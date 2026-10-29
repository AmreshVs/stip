const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { HIDDEN } = require('./snapshot');

const PRELOAD = path.join(__dirname, '..', 'preload.js');
const PAGE = path.join(__dirname, '..', 'renderer', 'settings', 'index.html');

class SettingsWindow {
  constructor() {
    this.win = null;
  }

  open(theme) {
    if (this.win) {
      this.win.show();
      this.win.focus();
      return this.win;
    }
    this.win = new BrowserWindow({
      width: 1120,
      height: 760,
      minWidth: 760,
      minHeight: 560,
      show: false,
      title: 'Stip settings',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      autoHideMenuBar: true,
      backgroundColor: theme === 'aurora' ? '#0c111e' : '#f3f0e8',
      webPreferences: { preload: PRELOAD, sandbox: true },
    });
    this.win.loadFile(PAGE);
    // A tray app has no dock icon; show one while settings are open so the
    // window can be found with Cmd+Tab.
    if (process.platform === 'darwin' && !HIDDEN) app.dock.show();
    this.win.once('ready-to-show', () => {
      if (!HIDDEN) this.win.show();
    });
    this.win.on('closed', () => {
      this.win = null;
      if (process.platform === 'darwin') app.dock.hide();
    });
    return this.win;
  }

  send(state) {
    this.win?.webContents.send('state', state);
  }
}

module.exports = { SettingsWindow };
