const path = require('node:path');
const { BrowserWindow, Tray, Menu, nativeImage, screen } = require('electron');
const { HIDDEN } = require('./snapshot');

const ICONS = path.join(__dirname, '..', '..', 'assets', 'generated');
const PRELOAD = path.join(__dirname, '..', 'preload.js');
const PANEL = { width: 380, height: 440 };
// Solid window colours, matching each theme's panel background.
const PANEL_BG = { flat: '#f3f0e8', aurora: '#0c111e' };

function trayIcon() {
  if (process.platform === 'darwin') {
    const image = nativeImage.createFromPath(path.join(ICONS, 'trayTemplate.png'));
    image.setTemplateImage(true);
    return image;
  }
  return nativeImage.createFromPath(path.join(ICONS, 'tray.png'));
}

// Places the panel next to the tray icon, kept inside the screen's work area.
function panelPosition(trayBounds, height) {
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const area = display.workArea;
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - PANEL.width / 2);
  // Tray at the top (macOS, some Linux) opens down, otherwise up.
  let y = trayBounds.y < area.y + area.height / 2 ? area.y + 6 : area.y + area.height - height - 6;
  x = Math.min(Math.max(x, area.x + 6), area.x + area.width - PANEL.width - 6);
  y = Math.min(Math.max(y, area.y), area.y + area.height - height);
  return { x, y };
}

class TrayUI {
  constructor({ onAction, theme = 'flat' }) {
    this.theme = theme;
    this.onAction = onAction;
    this.tray = new Tray(trayIcon());
    this.tray.setToolTip('Stip');
    this.panel = null;

    const menu = Menu.buildFromTemplate([
      { label: 'Open Stip', click: () => this.toggle() },
      { label: 'Stand now', click: () => onAction('stand-now') },
      { label: 'Water reminder now', click: () => onAction('water-now') },
      { label: 'Log a sip', click: () => onAction('sip') },
      { label: 'Pause for 1 hour', click: () => onAction('pause', { minutes: 60 }) },
      { type: 'separator' },
      { label: 'Settings', click: () => onAction('settings') },
      { label: 'Quit Stip', click: () => onAction('quit') },
    ]);

    if (process.platform === 'linux') {
      // Many Linux trays only support a menu, not click events.
      this.tray.setContextMenu(menu);
    } else {
      this.tray.on('click', () => this.toggle());
      this.tray.on('right-click', () => this.tray.popUpContextMenu(menu));
    }
  }

  createPanel() {
    this.panel = new BrowserWindow({
      ...PANEL,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      backgroundColor: PANEL_BG[this.theme] || PANEL_BG.flat,
      webPreferences: { preload: PRELOAD, sandbox: true },
    });
    this.panel.loadFile(path.join(__dirname, '..', 'renderer', 'tray', 'index.html'));
    this.panel.on('blur', () => this.panel.hide());
  }

  toggle() {
    if (!this.panel) this.createPanel();
    if (this.isOpen()) {
      this.hide();
      return;
    }
    // Snapshots and tests render the panel without showing it.
    if (HIDDEN) {
      this.panelOpen = true;
      return;
    }
    const { x, y } = panelPosition(this.tray.getBounds(), this.panel.getBounds().height);
    this.panel.setPosition(x, y, false);
    this.panel.show();
    this.panel.focus();
  }

  setTheme(theme) {
    this.theme = theme;
    this.panel?.setBackgroundColor(PANEL_BG[theme] || PANEL_BG.flat);
  }

  // The page reports its height so the window fits it exactly.
  resize(height) {
    if (!this.panel || !height) return;
    const bounds = this.panel.getBounds();
    if (bounds.height === height) return;
    // A panel that opens upward keeps its bottom edge in place.
    const opensUp = this.panel.isVisible() && bounds.y > screen.getDisplayMatching(bounds).workArea.y + 20;
    this.panel.setBounds({ ...bounds, height, y: opensUp ? bounds.y + bounds.height - height : bounds.y });
  }

  isOpen() {
    return Boolean(this.panel && (this.panel.isVisible() || this.panelOpen));
  }

  open() {
    if (!this.isOpen()) this.toggle();
    return this.panel;
  }

  hide() {
    this.panelOpen = false;
    this.panel?.hide();
  }

  // macOS shows the countdown right in the menu bar.
  setTitle(text) {
    if (process.platform === 'darwin') this.tray.setTitle(text, { fontType: 'monospacedDigit' });
    this.tray.setToolTip(text ? `Stip · next stand in ${text}` : 'Stip');
  }

  send(state) {
    if (this.isOpen()) this.panel.webContents.send('state', state);
  }
}

module.exports = { TrayUI };
