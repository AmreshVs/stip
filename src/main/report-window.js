const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, clipboard, ClipboardItem, dialog } = require('electron');
const { HIDDEN } = require('./snapshot');

const PRELOAD = path.join(__dirname, '..', 'preload.js');
const PAGE = path.join(__dirname, '..', 'renderer', 'report', 'index.html');

class ReportWindow {
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
      width: 1080,
      height: 780,
      minWidth: 860,
      minHeight: 620,
      show: false,
      title: 'Spine report',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      autoHideMenuBar: true,
      backgroundColor: theme === 'aurora' ? '#0c111e' : '#141414',
      webPreferences: { preload: PRELOAD, sandbox: true },
    });
    this.win.loadFile(PAGE);
    if (process.platform === 'darwin' && !HIDDEN) app.dock.show();
    this.win.once('ready-to-show', () => {
      if (!HIDDEN) this.win.show();
    });
    this.win.on('closed', () => {
      this.win = null;
      if (process.platform === 'darwin' && !BrowserWindow.getAllWindows().some((w) => w.isVisible())) app.dock.hide();
    });
    return this.win;
  }

  send(state) {
    this.win?.webContents.send('state', state);
  }

  async copy() {
    const image = await this.win.webContents.capturePage();
    const png = new Blob([image.toPNG()], { type: 'image/png' });
    await clipboard.write([new ClipboardItem({ 'image/png': png })]);
  }

  async save() {
    const image = await this.win.webContents.capturePage();
    const { canceled, filePath } = await dialog.showSaveDialog(this.win, {
      defaultPath: path.join(os.homedir(), 'Desktop', 'spine-report.png'),
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    });
    if (!canceled && filePath) fs.writeFileSync(filePath, image.toPNG());
  }

  async pickFolder() {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.win, {
      title: 'Choose a project folder',
      properties: ['openDirectory'],
    });
    return canceled ? null : filePaths[0];
  }
}

module.exports = { ReportWindow };
